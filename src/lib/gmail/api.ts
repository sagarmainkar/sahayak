import { getAccessToken, invalidateToken } from "./auth";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Gmail message payload shape (subset we use). */
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPart;
};

type GmailPart = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};

/** Gmail message list hit — ids only; follow up with get() for detail. */
export type GmailListHit = {
  id: string;
  threadId: string;
};

async function gfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const doFetch = async (token: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  let r = await doFetch(await getAccessToken());
  if (r.status === 401) {
    // Access token may have been revoked or simply expired past our
    // 60s guard; retry once with a fresh exchange.
    invalidateToken();
    r = await doFetch(await getAccessToken());
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`gmail ${r.status}: ${t.slice(0, 300)}`);
  }
  if (r.status === 204 || r.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return (await r.json()) as T;
}

/** Query the user's mailbox. `q` uses Gmail search syntax (from:/to:/
 *  subject:/newer_than:7d/label:inbox/is:unread/etc). Returns ids
 *  only — call getMessage for each hit to read metadata. */
export async function listMessages(
  q: string,
  maxResults: number,
): Promise<{ hits: GmailListHit[]; estimatedTotal: number }> {
  const params = new URLSearchParams({
    maxResults: String(Math.max(1, Math.min(100, maxResults))),
  });
  if (q.trim()) params.set("q", q);
  const data = await gfetch<{
    messages?: GmailListHit[];
    resultSizeEstimate?: number;
  }>(`${BASE}/messages?${params.toString()}`);
  return {
    hits: data.messages ?? [],
    estimatedTotal: data.resultSizeEstimate ?? 0,
  };
}

/** Fetch one message. `format` controls the payload size:
 *    - "metadata" + metadataHeaders=X,Y    → just the specified headers
 *    - "full"                              → everything, inc. MIME tree
 *    - "minimal"                           → just labelIds + snippet */
export async function getMessage(
  id: string,
  format: "full" | "metadata" | "minimal" = "full",
  metadataHeaders: string[] = [],
): Promise<GmailMessage> {
  const params = new URLSearchParams({ format });
  for (const h of metadataHeaders) params.append("metadataHeaders", h);
  return await gfetch<GmailMessage>(
    `${BASE}/messages/${encodeURIComponent(id)}?${params.toString()}`,
  );
}

/** Move a message to the trash. Requires gmail.modify scope. */
export async function trashMessage(id: string): Promise<GmailMessage> {
  return await gfetch<GmailMessage>(
    `${BASE}/messages/${encodeURIComponent(id)}/trash`,
    { method: "POST" },
  );
}


/** Add or remove labels on a message. Requires gmail.modify scope. */
export async function modifyLabels(
  id: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): Promise<GmailMessage> {
  return await gfetch<GmailMessage>(
    `${BASE}/messages/${encodeURIComponent(id)}/modify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    },
  );
}

/** Send a reply. `raw` is a base64url-encoded raw MIME message.
 *  Requires gmail.send or gmail.compose scope. */
export async function sendMessage(raw: string): Promise<GmailMessage> {
  return await gfetch<GmailMessage>(
    `${BASE}/messages/send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    },
  );
}

/** Read a specific header (case-insensitive). Returns "" if absent. */
export function header(msg: GmailMessage, name: string): string {
  const headers = msg.payload?.headers ?? [];
  for (const h of headers) {
    if (h.name?.toLowerCase() === name.toLowerCase()) return h.value ?? "";
  }
  return "";
}

function b64urlEncode(input: string): string {
  // Encode a UTF-8 string to base64url (RFC 4648 §5).
  // Gmail expects base64url (no padding, - and _ instead of + and /).
  const b64 = Buffer.from(input, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build a minimal MIME message from plain-text parts.
 *  Returns base64url-encoded raw message ready for sendMessage(). */
export function buildMimeMessage(params: {
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  inReplyTo?: string;
  references?: string;
  body: string;
  htmlBody?: string;
}): string {
  const sh = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

  const headers: string[] = [];

  if (params.from) headers.push(`From: ${sh(params.from)}`);
  headers.push(`To: ${sh(params.to)}`);
  if (params.cc) headers.push(`Cc: ${sh(params.cc)}`);
  if (params.bcc) headers.push(`Bcc: ${sh(params.bcc)}`);
  if (params.replyTo) headers.push(`Reply-To: ${sh(params.replyTo)}`);
  headers.push(`Subject: ${sh(params.subject)}`);
  if (params.inReplyTo) headers.push(`In-Reply-To: ${sh(params.inReplyTo)}`);
  if (params.references) headers.push(`References: ${sh(params.references)}`);

  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  headers.push("MIME-Version: 1.0");
  headers.push("Content-Type: multipart/alternative; boundary=" + boundary);

  const headerBlock = headers.join("\r\n") + "\r\n\r\n";

  // Part 1: text/plain
  const plainPart =
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n` +
    `Content-Transfer-Encoding: quoted-printable\r\n\r\n` +
    quotedPrintableEncode(params.body) +
    "\r\n";

  // Part 2: text/html — use caller-supplied HTML if provided, otherwise
  // convert the plain text body to a minimal <div> wrapper.
  const htmlSource = params.htmlBody ?? textToHtml(params.body);
  const htmlPart =
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n` +
    `Content-Transfer-Encoding: quoted-printable\r\n\r\n` +
    quotedPrintableEncode(htmlSource) +
    "\r\n";

  // Closing boundary
  const closing = `--${boundary}--\r\n`;

  const rawMime = headerBlock + plainPart + htmlPart + closing;
  return b64urlEncode(rawMime);
}

/** Encode text using quoted-printable (RFC 2045 §6.7).
 *  Correct order: encode special bytes first, then soft-wrap with bare `=`. */
function quotedPrintableEncode(text: string): string {
  // Normalise to CRLF line endings.
  const normalised = text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

  return normalised
    .split("\r\n")
    .map((line) => {
      // Step 1: encode each character to its UTF-8 bytes, then QP-escape
      // any byte that isn't a safe printable ASCII value.
      const encoded = Array.from(line) // iterate Unicode code points, not surrogates
        .map((ch) => {
          if (ch === "\t") return ch; // tab is always safe
          const cp = ch.codePointAt(0)!;
          if (cp >= 0x21 && cp <= 0x7e && ch !== "=") return ch; // safe printable
          // Encode as UTF-8 bytes.
          return Buffer.from(ch, "utf8")
            .reduce((acc, b) => acc + `=${b.toString(16).toUpperCase().padStart(2, "0")}`, "");
        })
        .join("");

      // Step 2: soft-wrap at 75 encoded chars (leaving room for the `=` marker).
      const chunks: string[] = [];
      let i = 0;
      while (i < encoded.length) {
        if (encoded.length - i <= 75) {
          chunks.push(encoded.slice(i));
          break;
        }
        chunks.push(encoded.slice(i, i + 75) + "="); // bare `=` = soft line break
        i += 75;
      }
      return chunks.join("\r\n");
    })
    .join("\r\n");
}

/** Convert plain text to simple HTML (for the HTML part of multipart). */
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div>${escaped.replace(/\n/g, "<br>")}</div>`;
}

function* walkParts(root: GmailPart | undefined): Iterable<GmailPart> {
  if (!root) return;
  yield root;
  for (const p of root.parts ?? []) yield* walkParts(p);
}

/** Strip HTML tags and decode the handful of entities the model
 *  actually cares about. Crude on purpose — we're not rendering, just
 *  giving the model readable text from the text/html fallback. */
function htmlToText(html: string): string {
  // Drop <script>/<style> content entirely.
  let s = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Convert <br>/<p> to newlines before stripping.
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p\s*>/gi, "\n\n");
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  // Decode common entities.
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };
  s = s.replace(
    /&(?:amp|lt|gt|quot|#39|nbsp);/g,
    (m) => entities[m] ?? m,
  );
  // Numeric entities (&#65; / &#x41;).
  s = s.replace(/&#(\d+);/g, (_, n) =>
    String.fromCharCode(parseInt(n, 10)),
  );
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
    String.fromCharCode(parseInt(n, 16)),
  );
  // Collapse runs of whitespace.
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Walk the MIME tree for the most-usable text. Prefers the first
 *  text/plain part; falls back to text/html stripped. Returns "" if
 *  the message has no textual body (e.g. image-only). */
export function extractBody(msg: GmailMessage): string {
  let plain: string | null = null;
  let html: string | null = null;
  for (const p of walkParts(msg.payload)) {
    const data = p.body?.data;
    if (!data) continue;
    const decoded = b64urlDecode(data);
    if (p.mimeType === "text/plain" && plain === null) plain = decoded;
    else if (p.mimeType === "text/html" && html === null) html = decoded;
  }
  if (plain) return plain;
  if (html) return htmlToText(html);
  return "";
}

function b64urlDecode(data: string): string {
  // Gmail bodies are base64url-encoded (RFC 4648 §5). Node's Buffer
  // accepts "base64url" directly on modern runtimes; we normalise +
  // pad for belt-and-suspenders.
  const s = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64").toString("utf8");
}

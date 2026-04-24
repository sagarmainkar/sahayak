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

/** Read a specific header (case-insensitive). Returns "" if absent. */
export function header(msg: GmailMessage, name: string): string {
  const headers = msg.payload?.headers ?? [];
  for (const h of headers) {
    if (h.name?.toLowerCase() === name.toLowerCase()) return h.value ?? "";
  }
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

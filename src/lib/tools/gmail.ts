import {
  extractBody,
  getMessage,
  header,
  listMessages,
  type GmailMessage,
} from "@/lib/gmail/api";
import { GmailNotConfiguredError } from "@/lib/gmail/auth";
import { err, ok, type ToolResult, type ToolSpec } from "./types";

/** Hard cap on body text returned from gmail_read (chars). */
const DEFAULT_MAX_CHARS = 2000;
const MAX_MAX_CHARS = 20_000;

function oneLine(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

async function runSafe(
  fn: () => Promise<Record<string, unknown>>,
): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof GmailNotConfiguredError) {
      return err("not_configured", e.message);
    }
    return err("gmail_failed", (e as Error).message);
  }
}

export const gmailSearch: ToolSpec = {
  name: "gmail_search",
  group: "gmail",
  description:
    "Search the user's Gmail. Query uses standard Gmail operators: " +
    "from:, to:, subject:, has:attachment, newer_than:7d, older_than:1y, " +
    "after:YYYY/MM/DD, label:inbox, is:unread, \"exact phrase\". " +
    "Returns one-line hits (id, date, from, subject, snippet) — pass each id " +
    "to gmail_read for the full body.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Gmail search query. Empty string returns recent inbox.",
      },
      n: {
        type: "integer",
        description: "Max results (1–50, default 10).",
      },
    },
    required: ["query"],
  },
  async handler(args) {
    const q = String(args.query ?? "");
    const n = Math.max(1, Math.min(50, Number(args.n ?? 10)));
    return runSafe(async () => {
      const { hits, estimatedTotal } = await listMessages(q, n);
      // N+1 fetch for metadata — fine at n≤50. Parallelised so the
      // latency floor is ~one Gmail API hop, not N.
      const detailed = await Promise.all(
        hits.map((h) =>
          getMessage(h.id, "metadata", ["From", "Subject", "Date"]).catch(
            () => null,
          ),
        ),
      );
      const messages = detailed
        .filter((m): m is GmailMessage => !!m)
        .map((m) => ({
          id: m.id,
          threadId: m.threadId,
          from: oneLine(header(m, "From"), 80),
          subject: oneLine(header(m, "Subject"), 100),
          date: header(m, "Date"),
          snippet: oneLine(m.snippet ?? "", 140),
        }));
      return { query: q, estimated_total: estimatedTotal, messages };
    });
  },
};

export const gmailRead: ToolSpec = {
  name: "gmail_read",
  group: "gmail",
  description:
    "Fetch one Gmail message's headers + plain-text body. Returns from/to/cc/" +
    "subject/date headers plus the message body (text/plain preferred, " +
    "text/html falls back to stripped text). Body is truncated to max_chars.",
  parameters: {
    type: "object",
    properties: {
      message_id: {
        type: "string",
        description: "Gmail message id (from gmail_search).",
      },
      max_chars: {
        type: "integer",
        description: `Body char cap (100–${MAX_MAX_CHARS}, default ${DEFAULT_MAX_CHARS}).`,
      },
    },
    required: ["message_id"],
  },
  async handler(args) {
    const id = String(args.message_id ?? "");
    if (!id) return err("bad_args", "message_id required");
    const cap = Math.max(
      100,
      Math.min(MAX_MAX_CHARS, Number(args.max_chars ?? DEFAULT_MAX_CHARS)),
    );
    return runSafe(async () => {
      const m = await getMessage(id, "full");
      const body = extractBody(m);
      const truncated = body.length > cap;
      return {
        id: m.id,
        threadId: m.threadId,
        labels: m.labelIds ?? [],
        headers: {
          from: header(m, "From"),
          to: header(m, "To"),
          cc: header(m, "Cc"),
          subject: header(m, "Subject"),
          date: header(m, "Date"),
          messageId: header(m, "Message-ID"),
        },
        body: truncated ? body.slice(0, cap) + "…" : body,
        body_truncated: truncated,
        body_full_chars: body.length,
      };
    });
  },
};

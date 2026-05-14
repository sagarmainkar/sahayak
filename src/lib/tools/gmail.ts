import {
  extractBody,
  getMessage,
  header,
  listMessages,
  trashMessage,
  modifyLabels,
  sendMessage,
  buildMimeMessage,
  type GmailMessage,
} from "@/lib/gmail/api";
import { GmailNotConfiguredError } from "@/lib/gmail/auth";
import { err, ok, type ToolResult, type ToolSpec } from "./types";

/** Hard cap on body text returned from gmail_read (chars). */
const DEFAULT_MAX_CHARS = 2000;
const MAX_MAX_CHARS = 20_000;

function oneLine(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "\u2026" : flat;
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

// ── Search ────────────────────────────────────────────────────────

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
      // N+1 fetch for metadata — fine at n\u226450. Parallelised so the
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

// ── Read ──────────────────────────────────────────────────────────

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
        body: truncated ? body.slice(0, cap) + "\u2026" : body,
        body_truncated: truncated,
        body_full_chars: body.length,
      };
    });
  },
};

// ── Delete (trash only) ───────────────────────────────────────────

export const gmailDelete: ToolSpec = {
  name: "gmail_delete",
  group: "gmail",
  description:
    "Move a Gmail message to trash (soft delete, recoverable within 30 days). " +
    "Requires gmail.modify scope. Always confirm with the user before trashing.",
  parameters: {
    type: "object",
    properties: {
      message_id: {
        type: "string",
        description: "Gmail message id (from gmail_search or gmail_read).",
      },
    },
    required: ["message_id"],
  },
  async handler(args) {
    const id = String(args.message_id ?? "");
    if (!id) return err("bad_args", "message_id required");

    return runSafe(async () => {
      const m = await getMessage(id, "metadata", ["From", "Subject", "Date"]);
      const result = await trashMessage(id);
      return {
        trashed: true,
        message_id: id,
        threadId: result.threadId,
        subject: oneLine(header(m, "Subject"), 100),
        from: oneLine(header(m, "From"), 80),
        note: "Message moved to trash. Auto-deleted after 30 days.",
      };
    });
  },
};

// ── Reply ─────────────────────────────────────────────────────────

export const gmailReply: ToolSpec = {
  name: "gmail_reply",
  group: "gmail",
  description:
    "Reply to a Gmail message. Reads the original message's headers " +
    "(To, Subject, Message-ID) and sends a multipart reply with the " +
    "provided body text. If recipients is not set, replies to the original " +
    "sender. Use reply_all=true to include original Cc recipients. " +
    "Requires gmail.send or gmail.compose scope.",
  parameters: {
    type: "object",
    properties: {
      message_id: {
        type: "string",
        description: "Gmail message id to reply to (from gmail_search or gmail_read).",
      },
      body: {
        type: "string",
        description: "The reply text. Plain text with \\n for line breaks.",
      },
      recipients: {
        type: "string",
        description:
          "Override reply-to address. Default is the original sender. " +
          "Can be comma-separated for multiple recipients.",
      },
      reply_all: {
        type: "boolean",
        description: "If true, include original Cc recipients (default false).",
      },
    },
    required: ["message_id", "body"],
  },
  async handler(args) {
    const id = String(args.message_id ?? "");
    const body = String(args.body ?? "");
    if (!id) return err("bad_args", "message_id required");
    if (!body.trim()) return err("bad_args", "body must not be empty");

    const replyAll = Boolean(args.reply_all);

    return runSafe(async () => {
      // Fetch the original message to get headers.
      const m = await getMessage(id, "full");
      const origFrom = header(m, "From");
      const origTo = header(m, "To");
      const origCc = header(m, "Cc");
      const origSubject = header(m, "Subject");
      const origMessageId = header(m, "Message-ID");
      const origReferences = header(m, "References");

      // Determine recipients.
      let toAddress: string;
      if (args.recipients) {
        toAddress = String(args.recipients);
      } else if (replyAll) {
        // reply-all: sender + all original To/Cc, minus the user's own address.
        // The user's address appears in the original To (they received it).
        const senderEmail = extractEmail(origFrom);
        const allAddrs = [origFrom, origTo, origCc]
          .filter(Boolean)
          .join(", ");
        // Split on comma boundaries respecting "Name <addr>" quoting.
        const parts = allAddrs
          .split(/,(?![^<]*>)/)
          .map((s) => s.trim())
          .filter(Boolean);
        // Remove self: any address whose extracted email matches the
        // To header of the original message (that's the user's address).
        const selfEmail = extractEmail(origTo)?.toLowerCase();
        const filtered = parts.filter((p) => {
          const e = extractEmail(p)?.toLowerCase();
          return e && e !== selfEmail;
        });
        toAddress = filtered.length
          ? filtered.join(", ")
          : senderEmail ?? origFrom;
      } else {
        toAddress = origFrom;
      }

      // Prepare subject with Re: prefix.
      const subject = origSubject.startsWith("Re:")
        ? origSubject
        : `Re: ${origSubject}`;

      // Build the raw MIME message.
      const raw = buildMimeMessage({
        to: toAddress,
        subject,
        inReplyTo: origMessageId,
        references: [origReferences, origMessageId].filter(Boolean).join(" "),
        body,
      });

      // Send.
      const sent = await sendMessage(raw);
      return {
        sent: true,
        message_id: sent.id,
        threadId: sent.threadId,
        to: toAddress,
        subject,
        body_length: body.length,
        inReplyTo: origMessageId,
      };
    });
  },
};

// ── Label ─────────────────────────────────────────────────────────

export const gmailLabel: ToolSpec = {
  name: "gmail_label",
  group: "gmail",
  description:
    "Add or remove labels on a Gmail message. Common labels: " +
    "IMPORTANT, LABEL_Important, LABEL_Starred, INBOX, UNREAD, SPAM, TRASH. " +
    "Use add_labels to apply, remove_labels to strip. Requires gmail.modify scope.",
  parameters: {
    type: "object",
    properties: {
      message_id: {
        type: "string",
        description: "Gmail message id (from gmail_search or gmail_read).",
      },
      add_labels: {
        type: "string",
        description: "Comma-separated labels to add (e.g. \"IMPORTANT,UNREAD\").",
      },
      remove_labels: {
        type: "string",
        description: "Comma-separated labels to remove (e.g. \"INBOX,UNREAD\").",
      },
    },
    required: ["message_id"],
  },
  async handler(args) {
    const id = String(args.message_id ?? "");
    if (!id) return err("bad_args", "message_id required");

    const addRaw = String(args.add_labels ?? "").trim();
    const removeRaw = String(args.remove_labels ?? "").trim();

    if (!addRaw && !removeRaw) {
      return err("bad_args", "At least one of add_labels or remove_labels required");
    }

    const addLabels = addRaw ? addRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const removeLabels = removeRaw ? removeRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

    return runSafe(async () => {
      const result = await modifyLabels(id, addLabels, removeLabels);
      return {
        labeled: true,
        message_id: result.id,
        threadId: result.threadId,
        labels: result.labelIds ?? [],
        added: addLabels.length ? addLabels : undefined,
        removed: removeLabels.length ? removeLabels : undefined,
      };
    });
  },
};

// ── Helpers ───────────────────────────────────────────────────────

/** Extract email address from "Name <email>" or bare "email". */
function extractEmail(addr: string): string | null {
  const m = addr.match(/<([^>]+)>/);
  return m ? m[1] : addr.includes("@") ? addr : null;
}

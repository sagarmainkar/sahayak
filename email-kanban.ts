import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Email Kanban Extension for pi
 *
 * Auto-generates a self-contained HTML kanban board whenever
 * gmail.gmailSearch returns results. The generated file is named
 * email-kanban-live.html and has real emails embedded.
 *
 * Install:
 *   cp email-kanban.ts ~/.pi/agent/extensions/
 *   # then in pi: /reload
 *
 * Usage:
 *   Just ask the agent to search your gmail, e.g.:
 *   "Search my gmail for is:inbox"
 *   The kanban HTML is auto-updated. Open it in your browser.
 */

export default function (pi: ExtensionAPI) {
  let lastEmails: any[] = [];
  let lastQuery = "is:inbox";

  // ── Intercept gmail.gmailSearch results ─────────────────────────
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "gmail.gmailSearch") return;

    try {
      const emails = extractEmailsFromResult(event.result);
      if (!emails || emails.length === 0) return;

      lastEmails = emails;

      // Try to read the query from nearby session entries
      const entries = ctx.sessionManager.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (
          entry.type === "toolCall" &&
          entry.toolName === "gmail.gmailSearch"
        ) {
          try {
            const args = JSON.parse(entry.arguments || "{}");
            if (args.q) lastQuery = args.q;
          } catch {}
          break;
        }
      }

      const outPath = await generateKanbanHtml(ctx.cwd, lastEmails, lastQuery);

      ctx.ui.notify(
        `📬 Kanban ready: ${outPath}  (${emails.length} emails)`,
        "info"
      );
    } catch (err: any) {
      ctx.ui.notify(`Kanban error: ${err.message}`, "error");
    }
  });

  // ── /email-kanban command (manual refresh) ──────────────────────
  pi.registerCommand("email-kanban", {
    description: "Generate email kanban HTML from last gmail search",
    handler: async (_args, ctx) => {
      if (lastEmails.length === 0) {
        ctx.ui.notify(
          "No gmail results cached yet. Ask me to search your gmail first.",
          "warning"
        );
        return;
      }
      const outPath = await generateKanbanHtml(ctx.cwd, lastEmails, lastQuery);
      ctx.ui.notify(`📬 Kanban refreshed: ${outPath}`, "success");
    },
  });

  // ── Helpers ───────────────────────────────────────────────────
  function extractEmailsFromResult(result: any): any[] | null {
    if (!result || !result.content) return null;

    for (const block of result.content) {
      if (block.type === "text" && block.text) {
        try {
          const parsed = JSON.parse(block.text);
          if (Array.isArray(parsed)) return parsed;
          if (parsed && parsed.messages) return parsed.messages;
          if (parsed && parsed.emails) return parsed.emails;
        } catch {
          // Not JSON — skip
        }
      }
    }
    return null;
  }

  async function generateKanbanHtml(
    cwd: string,
    emails: any[],
    query: string
  ): Promise<string> {
    const templatePath = join(cwd, "email-kanban.html");
    const outputPath = join(cwd, "email-kanban-live.html");

    let html = readFileSync(templatePath, "utf-8");

    // Normalize email shape
    const normalized = emails.map((e: any) => ({
      id: e.id || e.messageId || `email_${Math.random().toString(36).slice(2, 10)}`,
      from: e.from || e.sender || "",
      subject: e.subject || "",
      snippet: e.snippet || e.bodySnippet || e.preview || "",
      date: e.date || e.internalDate || new Date().toISOString(),
    }));

    // Build the injection script
    const injection = `<script>
    window.__EMAILS_DATA__ = ${JSON.stringify(normalized)};
    window.__GMAIL_QUERY__ = ${JSON.stringify(query)};
  </script>`;

    // Find the placeholder block and replace it
    const placeholderStart = html.indexOf("<!-- DATA INJECTION POINT");
    const placeholderEnd = html.indexOf("</script>", placeholderStart) + 9;

    if (placeholderStart !== -1 && placeholderEnd > placeholderStart) {
      html =
        html.slice(0, placeholderStart) +
        injection +
        html.slice(placeholderEnd);
    } else {
      // Fallback: inject right before the Babel script
      const babelIdx = html.indexOf('<script type="text/babel"');
      if (babelIdx !== -1) {
        html =
          html.slice(0, babelIdx) + injection + "\n  " + html.slice(babelIdx);
      }
    }

    writeFileSync(outputPath, html, "utf-8");
    return outputPath;
  }
}

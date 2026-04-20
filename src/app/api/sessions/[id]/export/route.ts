import { getSession, getAssistant } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function fmtDate(ms: number) {
  const d = new Date(ms);
  const iso = d.toISOString().replace(/\.\d+Z$/, "Z");
  return iso;
}

function messageToMd(m: ChatMessage, assistantName: string): string {
  const out: string[] = [];
  if (m.role === "user") {
    out.push("## You");
    out.push("");
    if (m.attachments?.length) {
      for (const a of m.attachments) {
        if (a.type === "image") {
          out.push(
            `![image (${a.mimeType})](data:${a.mimeType};base64,<omitted ${Math.round(
              a.data.length * 0.75,
            )} bytes>)`,
          );
        }
      }
      out.push("");
    }
    if (m.content) out.push(m.content);
  } else if (m.role === "assistant") {
    out.push(`## ${assistantName}`);
    out.push("");
    if (m.thinking) {
      out.push("<details>");
      out.push("<summary>Thinking</summary>");
      out.push("");
      out.push(m.thinking.trim());
      out.push("");
      out.push("</details>");
      out.push("");
    }
    if (m.content) out.push(m.content);
    if (m.toolCalls?.length) {
      out.push("");
      out.push("**Tool calls:**");
      for (const tc of m.toolCalls) {
        out.push("```json");
        out.push(JSON.stringify({ name: tc.name, arguments: tc.arguments }, null, 2));
        out.push("```");
      }
    }
  } else if (m.role === "tool") {
    out.push(`### 🔧 ${m.toolName ?? "tool"}`);
    out.push("");
    out.push("```json");
    // Attempt to pretty-print JSON
    try {
      out.push(JSON.stringify(JSON.parse(m.content), null, 2));
    } catch {
      out.push(m.content);
    }
    out.push("```");
  } else if (m.role === "system") {
    out.push("> **System**");
    for (const line of m.content.split("\n")) out.push(`> ${line}`);
  }
  return out.join("\n");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return new Response("not found", { status: 404 });
  }
  const assistant = await getAssistant(session.assistantId);
  const assistantName = assistant?.name ?? "assistant";
  const modelUsed = session.modelOverride ?? assistant?.model ?? "unknown";

  const lines: string[] = [];
  lines.push(`# ${session.title || "Untitled chat"}`);
  lines.push("");
  lines.push(`- **Assistant:** ${assistantName}`);
  lines.push(`- **Model:** \`${modelUsed}\``);
  lines.push(`- **Session id:** \`${session.id}\``);
  lines.push(`- **Created:** ${fmtDate(session.createdAt)}`);
  lines.push(`- **Updated:** ${fmtDate(session.updatedAt)}`);
  lines.push(
    `- **Tokens:** ${session.promptTokens.toLocaleString()} prompt · ${session.completionTokens.toLocaleString()} completion`,
  );
  lines.push(`- **Messages:** ${session.messages.length}`);
  if (assistant?.systemPrompt) {
    lines.push("");
    lines.push("### System prompt");
    lines.push("");
    lines.push("```");
    lines.push(assistant.systemPrompt);
    lines.push("```");
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  session.messages.forEach((m, i) => {
    lines.push(messageToMd(m, assistantName));
    lines.push("");
    if (i < session.messages.length - 1) {
      lines.push("---");
      lines.push("");
    }
  });

  const md = lines.join("\n");
  const filename = `${slugify(session.title || session.id)}-${session.id}.md`;

  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

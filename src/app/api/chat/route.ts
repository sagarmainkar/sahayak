import { OLLAMA_URL } from "@/lib/ollama";
import { TOOLS_BY_NAME, toolsForOllama } from "@/lib/tools";
import { readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MsgAttachment = {
  type: "image";
  mimeType: string;
  filename?: string;
  data?: string;
};

async function attachmentToBase64(a: MsgAttachment): Promise<string | null> {
  if (a.data) return a.data;
  if (a.filename) {
    const loaded = await readUpload(a.filename);
    if (!loaded) return null;
    return loaded.buffer.toString("base64");
  }
  return null;
}
type ClientMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  toolName?: string;
  attachments?: MsgAttachment[];
};

type ChatRequest = {
  model: string;
  messages: ClientMsg[];
  system?: string;
  think?: boolean | "low" | "medium" | "high";
  enabledTools?: string[];
  maxToolTurns?: number;
};

// Convert our client-shape messages to what Ollama wants.
type OllamaMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
  images?: string[];
};

async function toOllamaMessages(
  messages: ClientMsg[],
  system?: string,
): Promise<OllamaMsg[]> {
  const out: OllamaMsg[] = [];
  if (system && system.trim()) {
    out.push({ role: "system", content: system });
  }
  for (const m of messages) {
    const om: OllamaMsg = { role: m.role, content: m.content ?? "" };
    if (m.thinking) om.thinking = m.thinking;
    if (m.toolCalls && m.toolCalls.length) {
      om.tool_calls = m.toolCalls.map((tc) => ({
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    if (m.toolName) om.tool_name = m.toolName;
    if (m.attachments && m.attachments.length) {
      const images = await Promise.all(
        m.attachments
          .filter((a) => a.type === "image")
          .map(attachmentToBase64),
      );
      om.images = images.filter((b): b is string => !!b);
    }
    out.push(om);
  }
  return out;
}

function sse(controller: ReadableStreamDefaultController<Uint8Array>, obj: unknown) {
  const enc = new TextEncoder();
  controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;
  const enabled = body.enabledTools ?? [];
  const toolDefs = enabled.length ? toolsForOllama(enabled) : [];
  const maxToolTurns = body.maxToolTurns ?? 8;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const dec = new TextDecoder();
      const messages = await toOllamaMessages(body.messages, body.system);

      try {
        for (let turn = 0; turn < maxToolTurns; turn++) {
          const payload: Record<string, unknown> = {
            model: body.model,
            messages,
            stream: true,
            think: body.think ?? "medium",
          };
          if (toolDefs.length) payload.tools = toolDefs;

          const upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!upstream.ok || !upstream.body) {
            sse(controller, { type: "error", message: `ollama ${upstream.status}` });
            controller.close();
            return;
          }

          const reader = upstream.body.getReader();
          let buf = "";
          let assistantContent = "";
          let assistantThinking = "";
          let assistantToolCalls:
            | { name: string; arguments: Record<string, unknown> }[]
            | undefined;
          let promptTokens = 0;
          let evalTokens = 0;

          readChunks: while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              let chunk: {
                message?: {
                  content?: string;
                  thinking?: string;
                  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
                };
                prompt_eval_count?: number;
                eval_count?: number;
                done?: boolean;
              };
              try {
                chunk = JSON.parse(line);
              } catch {
                continue;
              }
              if (chunk.message?.content) {
                assistantContent += chunk.message.content;
                sse(controller, { type: "content", delta: chunk.message.content });
              }
              if (chunk.message?.thinking) {
                assistantThinking += chunk.message.thinking;
                sse(controller, { type: "thinking", delta: chunk.message.thinking });
              }
              if (chunk.message?.tool_calls) {
                assistantToolCalls = chunk.message.tool_calls.map((tc) => ({
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                }));
              }
              if (chunk.done) {
                promptTokens = chunk.prompt_eval_count ?? 0;
                evalTokens = chunk.eval_count ?? 0;
                sse(controller, {
                  type: "done_turn",
                  promptTokens,
                  completionTokens: evalTokens,
                });
                break readChunks;
              }
            }
          }

          // Record assistant turn into history
          messages.push({
            role: "assistant",
            content: assistantContent,
            ...(assistantThinking ? { thinking: assistantThinking } : {}),
            ...(assistantToolCalls && assistantToolCalls.length
              ? {
                  tool_calls: assistantToolCalls.map((tc) => ({
                    function: { name: tc.name, arguments: tc.arguments },
                  })),
                }
              : {}),
          });

          // Mirror to client state (so it can save)
          sse(controller, {
            type: "assistant_message",
            content: assistantContent,
            thinking: assistantThinking,
            toolCalls: assistantToolCalls,
          });

          // No tools called → we're done
          if (!assistantToolCalls || !assistantToolCalls.length) break;

          // Execute tools, append tool-role messages, loop
          for (const tc of assistantToolCalls) {
            sse(controller, {
              type: "tool_call",
              name: tc.name,
              arguments: tc.arguments,
            });
            const spec = TOOLS_BY_NAME[tc.name];
            let result: unknown;
            if (!spec) {
              result = { ok: false, error: "unknown_tool", message: `no tool ${tc.name}` };
            } else {
              try {
                result = await spec.handler(tc.arguments);
              } catch (e) {
                result = { ok: false, error: "tool_crashed", message: (e as Error).message };
              }
            }
            const fullJson = JSON.stringify(result);
            // For Ollama context on the next turn: keep compact.
            const forModel =
              fullJson.length > 4000
                ? fullJson.slice(0, 4000) +
                  `... [truncated ${fullJson.length - 4000} chars]`
                : fullJson;
            messages.push({
              role: "tool",
              content: forModel,
              tool_name: tc.name,
            });
            // For the client UI (and JSONL persistence): send full result.
            sse(controller, {
              type: "tool_result",
              name: tc.name,
              ok: (result as { ok?: boolean })?.ok ?? false,
              summary: fullJson,
            });
          }
        }

        sse(controller, { type: "end" });
        controller.close();
      } catch (e) {
        sse(controller, { type: "error", message: (e as Error).message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

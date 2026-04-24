import { nanoid } from "nanoid";
import { OLLAMA_URL } from "@/lib/ollama";
import {
  ALL_TOOLS,
  IMPLICIT_TOOL_NAMES,
  resolveTool,
  toolsForOllama,
} from "@/lib/tools";
import { readUpload, readUploadText, type UploadScope } from "@/lib/uploads";
import { REACT_ARTIFACT_INSTRUCTIONS } from "@/lib/store";
import { setPaused, type PausedLoop } from "@/lib/approvalStore";
import type { MsgAttachment } from "@/lib/types";
import type { ToolContext } from "@/lib/tools/types";

// Gate every tool by default for consistency — users can "approve for
// session" to skip the gate on subsequent calls in the same session.
// Previously only the destructive trio (execute_command, write_file,
// artifact_write_file) was gated; the rest were implicit-allow, which
// made the UX inconsistent across tools.
export const DEFAULT_REQUIRE_APPROVAL = ALL_TOOLS.map((t) => t.name);
const ARTIFACT_TOOLS = new Set(["artifact_create", "artifact_write_file"]);

type ToolCall = { name: string; arguments: Record<string, unknown> };

export type ClientMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  toolName?: string;
  attachments?: MsgAttachment[];
};

type OllamaMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
  images?: string[];
};

async function attachmentToBase64(
  scope: UploadScope,
  a: MsgAttachment,
): Promise<string | null> {
  if (a.type !== "image") return null;
  if (a.data) return a.data;
  if (a.filename) {
    const loaded = await readUpload(scope, a.filename);
    if (!loaded) return null;
    return loaded.buffer.toString("base64");
  }
  return null;
}

export async function toOllamaMessages(
  messages: ClientMsg[],
  scope: UploadScope,
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
      const imgB64s: (string | null)[] = [];
      const docChunks: string[] = [];
      for (const a of m.attachments) {
        if (a.type === "image") {
          imgB64s.push(await attachmentToBase64(scope, a));
        } else if (a.type === "document") {
          const text = await readUploadText(scope, a.textFilename);
          if (!text) continue;
          const label = a.originalName ?? a.filename;
          docChunks.push(
            `\n\nAttached: ${label}\n\`\`\`\n${text}\n\`\`\``,
          );
        }
      }
      const images = imgB64s.filter((b): b is string => !!b);
      if (images.length) om.images = images;
      if (docChunks.length) {
        // Documents get inlined into content on the wire. Client's
        // persisted message stays clean (just the refs).
        om.content = `${om.content}${docChunks.join("")}`;
      }
    }
    out.push(om);
  }
  return out;
}

export function injectArtifactInstructions(msgs: ClientMsg[]): ClientMsg[] {
  const out = [...msgs];
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      out[i] = {
        ...out[i],
        content:
          `${out[i].content}\n\n---\n${REACT_ARTIFACT_INSTRUCTIONS}`.trim(),
      };
      return out;
    }
  }
  return out;
}

export function filterArtifactTools(
  enabled: string[],
  artifactsEnabled: boolean,
): string[] {
  return artifactsEnabled
    ? enabled
    : enabled.filter((t) => !ARTIFACT_TOOLS.has(t));
}

function sse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  obj: unknown,
) {
  const enc = new TextEncoder();
  controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
}

/** Ask Ollama for one turn; stream content/thinking deltas through. */
async function callOllama(
  state: PausedLoop,
  toolDefs: Awaited<ReturnType<typeof toolsForOllama>>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  dec: TextDecoder,
): Promise<{
  content: string;
  thinking: string;
  toolCalls?: ToolCall[];
}> {
  const payload: Record<string, unknown> = {
    model: state.model,
    messages: state.messages,
    stream: true,
    think: state.think,
  };
  if (toolDefs.length) payload.tools = toolDefs;

  const upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!upstream.ok || !upstream.body) {
    throw new Error(`ollama ${upstream.status}`);
  }

  const reader = upstream.body.getReader();
  let buf = "";
  let content = "";
  let thinking = "";
  let toolCalls: ToolCall[] | undefined;

  while (true) {
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
        content += chunk.message.content;
        sse(controller, { type: "content", delta: chunk.message.content });
      }
      if (chunk.message?.thinking) {
        thinking += chunk.message.thinking;
        sse(controller, { type: "thinking", delta: chunk.message.thinking });
      }
      if (chunk.message?.tool_calls) {
        toolCalls = chunk.message.tool_calls.map((tc) => ({
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));
      }
      if (chunk.done) {
        sse(controller, {
          type: "done_turn",
          promptTokens: chunk.prompt_eval_count ?? 0,
          completionTokens: chunk.eval_count ?? 0,
        });
      }
    }
  }

  return { content, thinking, toolCalls };
}

/**
 * Runs the tool-calling loop. Can be called fresh (no resumeDecision) or
 * mid-pause (with a decision for the pending tool call). Pauses the loop
 * — by saving state and emitting `tool_approval_required` — when it hits
 * a tool in `requireApproval` that isn't in `autoApproveTools`.
 *
 * Always closes the stream (both on pause and on normal completion). The
 * caller must not close it themselves.
 */
export async function runToolLoop(
  state: PausedLoop,
  controller: ReadableStreamDefaultController<Uint8Array>,
  resumeDecision?: "approve" | "deny",
): Promise<void> {
  const dec = new TextDecoder();
  const toolDefs = state.enabledTools.length
    ? await toolsForOllama(state.enabledTools)
    : [];

  let nextDecision = resumeDecision;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    try {
      controller.close();
    } catch {}
  }

  try {
    while (state.turn < state.maxToolTurns) {
      // New turn: ask Ollama unless we're mid-batch resuming.
      if (state.pendingToolCalls.length === 0) {
        const turnResult = await callOllama(state, toolDefs, controller, dec);

        state.messages.push({
          role: "assistant",
          content: turnResult.content,
          ...(turnResult.thinking ? { thinking: turnResult.thinking } : {}),
          ...(turnResult.toolCalls && turnResult.toolCalls.length
            ? {
                tool_calls: turnResult.toolCalls.map((tc) => ({
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              }
            : {}),
        });

        sse(controller, {
          type: "assistant_message",
          content: turnResult.content,
          thinking: turnResult.thinking,
          toolCalls: turnResult.toolCalls,
        });

        if (!turnResult.toolCalls || !turnResult.toolCalls.length) break;
        state.pendingToolCalls = turnResult.toolCalls;
        state.pendingApprovalIndex = 0;
      }

      // Walk the pending tool-call batch, pausing at the first that needs
      // user approval (unless resumeDecision covers the current index).
      while (state.pendingApprovalIndex < state.pendingToolCalls.length) {
        const tc = state.pendingToolCalls[state.pendingApprovalIndex];
        // Every tool is gated by default. autoApproveTools is the only
        // bypass. The old requireApproval "closed list" approach let
        // MCP tools (dynamically discovered, never added to the list)
        // slip past unchecked — a HITL hole this closes.
        // Implicit tools (memory: remember/recall/list) bypass HITL
        // entirely — they're invisible infrastructure, not user-driven
        // actions, and the user never enabled them in the picker.
        const preApproved =
          IMPLICIT_TOOL_NAMES.has(tc.name) ||
          state.autoApproveTools.includes(tc.name);

        if (nextDecision === undefined && !preApproved) {
          const token = nanoid(16);
          setPaused(token, { ...state, createdAt: Date.now() });
          sse(controller, {
            type: "tool_approval_required",
            token,
            toolName: tc.name,
            arguments: tc.arguments,
            index: state.pendingApprovalIndex,
          });
          close();
          return;
        }

        // Per-call id so the client can pair this tool_call with its
        // tool_result. Sequential on this backend, but we emit the id for
        // wire-protocol parity with the pi backend (which is parallel).
        const callId = nanoid(12);
        sse(controller, {
          type: "tool_call",
          id: callId,
          name: tc.name,
          arguments: tc.arguments,
        });

        let result: unknown;
        if (nextDecision === "deny") {
          result = {
            ok: false,
            error: "user_denied",
            message: `The user declined to approve the ${tc.name} call.`,
          };
        } else {
          const spec = await resolveTool(tc.name);
          if (!spec) {
            result = {
              ok: false,
              error: "unknown_tool",
              message: `no tool ${tc.name}`,
            };
          } else {
            try {
              const ctx: ToolContext = {
                assistantId: state.assistantId,
                sessionId: state.sessionId,
              };
              result = await spec.handler(tc.arguments, ctx);
            } catch (e) {
              result = {
                ok: false,
                error: "tool_crashed",
                message: (e as Error).message,
              };
            }
          }
        }

        const fullJson = JSON.stringify(result);
        const forModel =
          fullJson.length > 4000
            ? fullJson.slice(0, 4000) +
              `... [truncated ${fullJson.length - 4000} chars]`
            : fullJson;
        state.messages.push({
          role: "tool",
          content: forModel,
          tool_name: tc.name,
        });
        sse(controller, {
          type: "tool_result",
          id: callId,
          name: tc.name,
          ok: (result as { ok?: boolean })?.ok ?? false,
          summary: fullJson,
        });

        state.pendingApprovalIndex++;
        // Decision only applies to the one tool call that was paused; the
        // next one in the batch goes through the normal approval check.
        nextDecision = undefined;
      }

      state.pendingToolCalls = [];
      state.pendingApprovalIndex = 0;
      state.turn++;
    }

    sse(controller, { type: "end" });
  } catch (e) {
    sse(controller, { type: "error", message: (e as Error).message });
  } finally {
    close();
  }
}

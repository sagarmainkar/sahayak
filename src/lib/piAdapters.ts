import { Type, type Message, type Model, type TextContent } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { OLLAMA_URL } from "@/lib/ollama";
import { TOOLS_BY_NAME } from "@/lib/tools";
import type { ToolSpec } from "@/lib/tools/types";
import { readUpload, readUploadText } from "@/lib/uploads";
import type { ClientMsg } from "@/lib/toolLoop";
import type { MsgAttachment } from "@/lib/types";

/**
 * Build a pi-ai Model for an Ollama-hosted model via its OpenAI-compatible
 * `/v1` endpoint. pi-ai's `getModel` registry doesn't know about Ollama, so
 * we construct the Model by hand. `compat` disables OpenAI-only features
 * (store, reasoning_effort, developer role) that Ollama rejects.
 *
 * Note: `num_ctx` from the modelfile is respected server-side by Ollama;
 * it can't be passed over `/v1`, so we don't try.
 */
export function piModelForOllama(modelId: string): Model<"openai-completions"> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "ollama",
    baseUrl: `${OLLAMA_URL}/v1`,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8192,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: "max_tokens",
      requiresToolResultName: false,
      requiresAssistantAfterToolResult: false,
      requiresThinkingAsText: false,
      thinkingFormat: "openai",
      supportsStrictMode: false,
    },
  };
}

/** Map Sahayak thinkMode → pi-agent-core ThinkingLevel. */
export function piThinkLevel(
  think: boolean | "off" | "low" | "medium" | "high" | undefined,
): ThinkingLevel {
  if (think === undefined) return "medium";
  if (think === false || think === "off") return "off";
  if (think === true) return "medium";
  return think;
}

/**
 * Wrap a Sahayak ToolSpec as a pi-agent-core AgentTool.
 *
 * The JSON-schema from ToolSpec.parameters is passed through via
 * `Type.Unsafe` — TypeBox accepts it as-is without validating structure,
 * which is what we want because our handlers already tolerate the
 * loosely-typed `Record<string, unknown>` shape.
 *
 * Tool output for the model is capped at 4000 chars (same as the native
 * loop). The full JSON is stashed in `details` so the UI can render it.
 */
export function piToolFromSpec(spec: ToolSpec): AgentTool {
  return {
    name: spec.name,
    description: spec.description,
    label: spec.name,
    parameters: Type.Unsafe(spec.parameters),
    async execute(_toolCallId, params) {
      let result: { ok?: boolean; [k: string]: unknown };
      try {
        result = await spec.handler(params as Record<string, unknown>);
      } catch (e) {
        result = {
          ok: false,
          error: "tool_crashed",
          message: (e as Error).message,
        };
      }
      const fullJson = JSON.stringify(result);
      const forModel =
        fullJson.length > 4000
          ? fullJson.slice(0, 4000) +
            `... [truncated ${fullJson.length - 4000} chars]`
          : fullJson;
      const isError = !result.ok;
      const content: TextContent[] = [{ type: "text", text: forModel }];
      return { content, details: { full: fullJson, ok: !isError } };
    },
  };
}

export function piToolsFromEnabled(enabled: string[]): AgentTool[] {
  return enabled
    .map((n) => TOOLS_BY_NAME[n])
    .filter((s): s is ToolSpec => !!s)
    .map(piToolFromSpec);
}

async function attachmentImageData(a: MsgAttachment): Promise<
  { data: string; mimeType: string } | null
> {
  if (a.type !== "image") return null;
  if (a.data) return { data: a.data, mimeType: a.mimeType };
  if (a.filename) {
    const loaded = await readUpload(a.filename);
    if (!loaded) return null;
    return { data: loaded.buffer.toString("base64"), mimeType: a.mimeType };
  }
  return null;
}

async function expandDocsIntoText(
  content: string,
  attachments: MsgAttachment[] | undefined,
): Promise<string> {
  if (!attachments) return content;
  const chunks: string[] = [];
  for (const a of attachments) {
    if (a.type !== "document") continue;
    const text = await readUploadText(a.textFilename);
    if (!text) continue;
    const label = a.originalName ?? a.filename;
    chunks.push(`\n\nAttached: ${label}\n\`\`\`\n${text}\n\`\`\``);
  }
  return chunks.length ? `${content}${chunks.join("")}` : content;
}

/**
 * Convert Sahayak ClientMsg[] → pi-ai Message[].
 *
 * - User messages: documents inline into the text (matches native behavior);
 *   images become ImageContent blocks.
 * - Assistant messages: text + optional thinking + tool calls. Each tool
 *   call gets a synthetic id matched by the following tool-role message so
 *   pi-ai's ToolResultMessage.toolCallId points at something real.
 * - Tool messages: consume the next queued id from the preceding assistant.
 *
 * The synthetic ids are stable for a given transcript walk but not across
 * calls — that's fine since pi-ai only uses them within a single request.
 */
export async function toPiMessages(msgs: ClientMsg[]): Promise<Message[]> {
  const out: Message[] = [];
  let callCounter = 0;
  // Queue of (tool name → id) pairs emitted by the last assistant, in order,
  // for the following tool-role messages to consume.
  let pendingIds: { name: string; id: string }[] = [];

  for (const m of msgs) {
    if (m.role === "system") {
      // System content gets hoisted into `systemPrompt` by the caller.
      // Stray system messages inside the transcript would confuse pi-ai,
      // so we drop them silently here.
      continue;
    }

    if (m.role === "user") {
      const text = await expandDocsIntoText(m.content ?? "", m.attachments);
      const images: { type: "image"; data: string; mimeType: string }[] = [];
      for (const a of m.attachments ?? []) {
        const img = await attachmentImageData(a);
        if (img) images.push({ type: "image", ...img });
      }
      out.push({
        role: "user",
        content: images.length
          ? [{ type: "text", text }, ...images]
          : text,
        timestamp: Date.now(),
      });
      continue;
    }

    if (m.role === "assistant") {
      const content: (
        | { type: "text"; text: string }
        | { type: "thinking"; thinking: string }
        | {
            type: "toolCall";
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          }
      )[] = [];
      if (m.thinking) content.push({ type: "thinking", thinking: m.thinking });
      if (m.content) content.push({ type: "text", text: m.content });
      pendingIds = [];
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          const id = `tc_${callCounter++}`;
          pendingIds.push({ name: tc.name, id });
          content.push({
            type: "toolCall",
            id,
            name: tc.name,
            arguments: tc.arguments,
          });
        }
      }
      out.push({
        role: "assistant",
        content,
        api: "openai-completions",
        provider: "ollama",
        model: "",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: pendingIds.length ? "toolUse" : "stop",
        timestamp: Date.now(),
      });
      continue;
    }

    if (m.role === "tool") {
      // Pair with the first pending id whose name matches, else fall back
      // to the next pending id regardless of name. If nothing pends (e.g.
      // the transcript got truncated mid-turn), invent a throwaway id.
      let id: string;
      const matchIdx = pendingIds.findIndex(
        (p) => p.name === (m.toolName ?? ""),
      );
      if (matchIdx >= 0) {
        id = pendingIds[matchIdx].id;
        pendingIds.splice(matchIdx, 1);
      } else if (pendingIds.length) {
        id = pendingIds.shift()!.id;
      } else {
        id = `tc_orphan_${callCounter++}`;
      }
      out.push({
        role: "toolResult",
        toolCallId: id,
        toolName: m.toolName ?? "unknown",
        content: [{ type: "text", text: m.content ?? "" }],
        isError: false,
        timestamp: Date.now(),
      });
      continue;
    }
  }

  return out;
}

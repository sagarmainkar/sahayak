import { Type, type Message, type Model, type TextContent } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { OLLAMA_URL } from "@/lib/ollama";
import { resolveTool, withImplicit } from "@/lib/tools";
import type { ToolSpec } from "@/lib/tools/types";
import { readUpload, readUploadText, type UploadScope } from "@/lib/uploads";
import type { ToolContext } from "@/lib/tools/types";
import type { ClientMsg } from "@/lib/toolLoop";
import type { MsgAttachment } from "@/lib/types";

/**
 * Build a pi-ai Model for any OpenAI-compatible server (Ollama's
 * `/v1`, llama.cpp's `/v1`, vLLM, etc.). pi-ai's `getModel` registry
 * doesn't know about local backends, so we construct the Model by
 * hand. `compat` disables OpenAI-only features (store,
 * reasoning_effort, developer role) that these servers reject.
 *
 * `baseUrl` must end with `/v1` (or whatever prefix the server uses
 * before `/chat/completions`). The caller normalises.
 */
export function piModelForOpenAICompat(
  baseUrl: string,
  modelId: string,
  provider: "ollama" | "llama-cpp" = "ollama",
): Model<"openai-completions"> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    // pi-ai's Model.provider is a free-form string that shows up in
    // telemetry; "llama-cpp" or "ollama" both work.
    provider: provider as unknown as Model<"openai-completions">["provider"],
    baseUrl,
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

/** Back-compat thin wrapper. Ollama's `/v1` base is derived from
 *  `OLLAMA_URL`; `num_ctx` from the modelfile is respected
 *  server-side by Ollama and can't be passed over `/v1`, so we
 *  don't try. */
export function piModelForOllama(modelId: string): Model<"openai-completions"> {
  return piModelForOpenAICompat(`${OLLAMA_URL}/v1`, modelId, "ollama");
}

/** Normalise a user-supplied llama.cpp URL into a usable pi-ai
 *  `baseUrl`. Accepts bare `http://host:port`, `http://host:port/`,
 *  or `http://host:port/v1`. Returns the `/v1` form with no trailing
 *  slash. Returns null for obviously bad input so callers can
 *  surface a friendly error. */
export function normalizeOpenAiBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    // Validate it parses.
    new URL(trimmed);
  } catch {
    return null;
  }
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
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
export function piToolFromSpec(spec: ToolSpec, ctx: ToolContext): AgentTool {
  return {
    name: spec.name,
    description: spec.description,
    label: spec.name,
    parameters: Type.Unsafe(spec.parameters),
    async execute(_toolCallId, params) {
      let result: { ok?: boolean; [k: string]: unknown };
      try {
        result = await spec.handler(params as Record<string, unknown>, ctx);
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

export async function piToolsFromEnabled(
  enabled: string[],
  ctx: ToolContext,
): Promise<AgentTool[]> {
  // withImplicit appends the always-on memory tools so the model has
  // them regardless of what the assistant enabled.
  const names = withImplicit(enabled);
  const specs = await Promise.all(names.map((n) => resolveTool(n)));
  return specs
    .filter((s): s is ToolSpec => !!s)
    .map((s) => piToolFromSpec(s, ctx));
}

async function attachmentImageData(
  scope: UploadScope,
  a: MsgAttachment,
): Promise<{ data: string; mimeType: string } | null> {
  if (a.type !== "image") return null;
  if (a.data) return { data: a.data, mimeType: a.mimeType };
  if (a.filename) {
    const loaded = await readUpload(scope, a.filename);
    if (!loaded) return null;
    return { data: loaded.buffer.toString("base64"), mimeType: a.mimeType };
  }
  return null;
}

async function expandDocsIntoText(
  scope: UploadScope,
  content: string,
  attachments: MsgAttachment[] | undefined,
): Promise<string> {
  if (!attachments) return content;
  const chunks: string[] = [];
  for (const a of attachments) {
    if (a.type !== "document") continue;
    const text = await readUploadText(scope, a.textFilename);
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
export async function toPiMessages(
  msgs: ClientMsg[],
  scope: UploadScope,
): Promise<Message[]> {
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
      const text = await expandDocsIntoText(
        scope,
        m.content ?? "",
        m.attachments,
      );
      const images: { type: "image"; data: string; mimeType: string }[] = [];
      for (const a of m.attachments ?? []) {
        const img = await attachmentImageData(scope, a);
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

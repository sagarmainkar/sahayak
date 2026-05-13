import { nanoid } from "nanoid";
import { Agent } from "@mariozechner/pi-agent-core";
import type {
  AgentEvent,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolCall } from "@mariozechner/pi-ai";
import {
  appendEvent,
  setJobStatus,
  setJobAbort,
  pauseForApproval,
  getJob,
} from "@/lib/jobRegistry";
import { appendMessage, updateSessionMeta } from "@/lib/store";
import {
  piModelForOllama,
  piModelForOpenAICompat,
  piThinkLevel,
  piToolsFromEnabled,
  toPiMessages,
} from "@/lib/piAdapters";
import type { ClientMsg } from "@/lib/toolLoop";
import { IMPLICIT_TOOL_NAMES } from "@/lib/tools";
import type { ChatMessage } from "@/lib/types";

export type JobRunnerInput = {
  jobId: string;
  systemPrompt: string;
  clientMessages: ClientMsg[];
  model: string;
  think: boolean | "off" | "low" | "medium" | "high";
  enabledTools: string[];
  autoApproveTools: string[];
  requireApproval: string[];
  maxToolTurns: number;
  assistantId: string;
  sessionId: string;
  provider: "ollama" | "llama-cpp";
  llamaBaseUrl?: string;
};

export function spawnJobRunner(input: JobRunnerInput): void {
  runJob(input).catch((err: unknown) => {
    appendEvent(input.jobId, {
      type: "error",
      message: (err as Error).message ?? String(err),
    });
    setJobStatus(input.jobId, "failed");
  });
}

async function runJob(input: JobRunnerInput): Promise<void> {
  const {
    jobId,
    systemPrompt,
    clientMessages,
    model,
    think,
    enabledTools,
    maxToolTurns,
    assistantId,
    sessionId,
    provider,
    llamaBaseUrl,
  } = input;

  const scope = { assistantId, sessionId };

  const piModel =
    provider === "llama-cpp" && llamaBaseUrl
      ? piModelForOpenAICompat(llamaBaseUrl, model, "llama-cpp")
      : piModelForOllama(model);

  const tools = await piToolsFromEnabled(enabledTools, scope);
  const messages = await toPiMessages(clientMessages, scope);

  let turnCount = 0;
  const toolCallArgs = new Map<string, Record<string, unknown>>();

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: piModel,
      tools,
      thinkingLevel: piThinkLevel(think),
      messages,
    },
    toolExecution: "parallel",
    getApiKey: () => "ollama",
    beforeToolCall: async (
      ctx: BeforeToolCallContext,
    ): Promise<BeforeToolCallResult | undefined> => {
      const toolName = ctx.toolCall.name;
      const liveJob = getJob(jobId);
      const liveAutoApprove = liveJob?.autoApproveTools ?? input.autoApproveTools;

      const preApproved =
        IMPLICIT_TOOL_NAMES.has(toolName) || liveAutoApprove.includes(toolName);

      if (preApproved) return undefined;

      const token = nanoid(16);
      appendEvent(jobId, {
        type: "tool_approval_required",
        token,
        toolName,
        arguments: ctx.toolCall.arguments,
      });

      const decision = await pauseForApproval(
        jobId,
        token,
        toolName,
        ctx.toolCall.arguments,
      );

      if (decision === "deny") {
        return { block: true, reason: `User declined ${toolName}` };
      }
      if (decision === "cancel") {
        agent.abort();
        return { block: true, reason: "user_cancelled" };
      }
      return undefined;
    },
  });

  setJobAbort(jobId, () => agent.abort());

  agent.subscribe(async (event: AgentEvent) => {
    try {
      if (event.type === "turn_start") {
        turnCount++;
        if (turnCount > maxToolTurns) {
          agent.abort();
        }
        return;
      }

      if (event.type === "message_update") {
        const ev = event.assistantMessageEvent;
        if (ev.type === "text_delta") {
          appendEvent(jobId, { type: "content", delta: ev.delta });
        } else if (ev.type === "thinking_delta") {
          appendEvent(jobId, { type: "thinking", delta: ev.delta });
        }
        return;
      }

      if (event.type === "message_end") {
        const msg = event.message as AssistantMessage;
        if (msg.role !== "assistant") return;

        if (msg.stopReason === "error" || msg.stopReason === "aborted") {
          appendEvent(jobId, {
            type: "error",
            message: msg.errorMessage ?? msg.stopReason,
          });
          return;
        }

        let text = "";
        let thinking = "";
        const toolCalls: { name: string; arguments: Record<string, unknown> }[] = [];

        for (const part of msg.content) {
          if (part.type === "text") text += part.text;
          else if (part.type === "thinking") thinking += part.thinking;
          else if (part.type === "toolCall") {
            toolCalls.push({ name: (part as ToolCall).name, arguments: (part as ToolCall).arguments });
          }
        }

        const promptTokens =
          (msg.usage?.input ?? 0) + (msg.usage?.cacheRead ?? 0);
        const completionTokens = msg.usage?.output ?? 0;

        appendEvent(jobId, {
          type: "done_turn",
          promptTokens,
          completionTokens,
        });
        appendEvent(jobId, {
          type: "assistant_message",
          content: text,
          thinking: thinking || undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
        });

        await updateSessionMeta(assistantId, sessionId, {
          promptTokens,
          completionTokens,
        });

        const chatMsg: ChatMessage = {
          id: nanoid(12),
          role: "assistant",
          content: text,
          ...(thinking ? { thinking } : {}),
          ...(toolCalls.length ? { toolCalls } : {}),
          stopReason: msg.stopReason,
          completionTokens,
          createdAt: Date.now(),
        };
        await appendMessage(assistantId, sessionId, chatMsg);
        return;
      }

      if (event.type === "tool_execution_start") {
        const args = event.args as Record<string, unknown>;
        toolCallArgs.set(event.toolCallId, args);
        appendEvent(jobId, {
          type: "tool_call",
          id: event.toolCallId,
          name: event.toolName,
          arguments: args,
        });
        return;
      }

      if (event.type === "tool_execution_end") {
        const details = event.result?.details as { full?: string } | undefined;
        const summary =
          details?.full ?? JSON.stringify(event.result ?? null);
        appendEvent(jobId, {
          type: "tool_result",
          id: event.toolCallId,
          name: event.toolName,
          ok: !event.isError,
          summary,
        });

        const savedArgs = toolCallArgs.get(event.toolCallId);
        toolCallArgs.delete(event.toolCallId);
        const toolMsg: ChatMessage = {
          id: nanoid(12),
          role: "tool",
          content: summary,
          toolName: event.toolName,
          ...(savedArgs ? { toolArgs: savedArgs } : {}),
          createdAt: Date.now(),
        };
        await appendMessage(assistantId, sessionId, toolMsg);
        return;
      }

      if (event.type === "agent_end") {
        appendEvent(jobId, { type: "end" });
        setJobStatus(jobId, "completed");
        return;
      }
    } catch (err) {
      appendEvent(jobId, {
        type: "error",
        message: (err as Error).message ?? String(err),
      });
    }
  });

  await agent.continue();
}

import { nanoid } from "nanoid";
import { Agent } from "@mariozechner/pi-agent-core";
import type {
  AgentEvent,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolCall } from "@mariozechner/pi-ai";
import {
  piModelForOllama,
  piThinkLevel,
  piToolsFromEnabled,
  toPiMessages,
} from "@/lib/piAdapters";
import type { ClientMsg } from "@/lib/toolLoop";

type Decision = "approve" | "deny" | "cancel";
type Controller = ReadableStreamDefaultController<Uint8Array>;

/**
 * Input to a fresh run. Shape is deliberately decoupled from the native
 * backend's `PausedLoop` — pi-agent-core owns turn state internally, so we
 * pass a "cold" description and let the Agent drive.
 */
export type PiRunInput = {
  systemPrompt: string;
  clientMessages: ClientMsg[];
  model: string;
  think: boolean | "off" | "low" | "medium" | "high";
  enabledTools: string[];
  autoApproveTools: string[];
  requireApproval: string[];
  /** Hard cap on LLM turns to match the native `maxToolTurns`. */
  maxToolTurns: number;
};

type PauseEntry = {
  agent: Agent;
  /** Resolver for the decision promise awaited inside `beforeToolCall`. */
  resolve: (d: Decision) => void;
  /** Mutable allowlist — resume can extend it via splice/push. */
  autoApproveTools: string[];
  requireApproval: string[];
  createdAt: number;
};

const pending = new Map<string, PauseEntry>();
const runStateByAgent = new Map<Agent, { rebind: (c: Controller) => void }>();
const TTL_MS = 10 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (now - v.createdAt > TTL_MS) {
      pending.delete(k);
      try {
        v.agent.abort();
      } catch {}
      try {
        v.resolve("cancel");
      } catch {}
    }
  }
}

function sse(controller: Controller, obj: unknown) {
  const enc = new TextEncoder();
  try {
    controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
  } catch {
    // Controller already closed; drop the event.
  }
}

/** Close a controller, swallowing double-close errors. */
function safeClose(c: Controller) {
  try {
    c.close();
  } catch {}
}

/**
 * Subscribe to agent events and re-emit as Sahayak SSE events. Returns the
 * unsubscribe function. `onEnd` fires once when `agent_end` arrives.
 *
 * `turnState` is a ref shared across rebinds so the turn cap survives a
 * pause/resume cycle — counting lives with the Agent instance, not the
 * individual SSE stream.
 */
function attachTranslator(
  agent: Agent,
  controller: Controller,
  turnState: { turnCount: number; maxTurns: number; capped: boolean },
  onEnd: () => void,
): () => void {
  return agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case "turn_start": {
        turnState.turnCount++;
        if (!turnState.capped && turnState.turnCount > turnState.maxTurns) {
          turnState.capped = true;
          sse(controller, {
            type: "error",
            message: `maxToolTurns exceeded (${turnState.maxTurns})`,
          });
          // abort() unwinds the Agent; agent_end will fire and tear
          // everything down through the onEnd path below.
          try {
            agent.abort();
          } catch {}
        }
        return;
      }
      case "message_update": {
        const ev = event.assistantMessageEvent;
        if (ev.type === "text_delta") {
          sse(controller, { type: "content", delta: ev.delta });
        } else if (ev.type === "thinking_delta") {
          sse(controller, { type: "thinking", delta: ev.delta });
        }
        return;
      }
      case "message_end": {
        const msg = event.message as AssistantMessage;
        if (msg.role !== "assistant") return;
        // pi-agent-core encodes runtime failures into the final message
        // rather than rejecting the prompt/continue promise. Surface those
        // to the client as an SSE error — the client shows them inline and
        // won't try to persist the half-turn as a normal assistant reply.
        if (msg.stopReason === "error" || msg.stopReason === "aborted") {
          sse(controller, {
            type: "error",
            message:
              msg.errorMessage ??
              (msg.stopReason === "aborted"
                ? "stream aborted"
                : "stream error"),
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
            toolCalls.push({ name: part.name, arguments: part.arguments });
          }
        }
        sse(controller, {
          type: "done_turn",
          promptTokens: msg.usage?.input ?? 0,
          completionTokens: msg.usage?.output ?? 0,
        });
        sse(controller, {
          type: "assistant_message",
          content: text,
          thinking,
          toolCalls: toolCalls.length ? toolCalls : undefined,
        });
        return;
      }
      case "tool_execution_start": {
        sse(controller, {
          type: "tool_call",
          // Forward pi-agent-core's toolCallId so the client can match the
          // terminating tool_result to THIS card — required for parallel
          // execution where multiple calls are in flight at once.
          id: event.toolCallId,
          name: event.toolName,
          arguments: event.args ?? {},
        });
        return;
      }
      case "tool_execution_end": {
        // Our pi tool wrapper stashes the stringified full JSON in
        // `details.full`. Fall back to JSON-stringifying the whole result
        // in case a tool went off-spec.
        const details = event.result?.details as
          | { full?: string }
          | undefined;
        const summary =
          details?.full ?? JSON.stringify(event.result ?? null);
        sse(controller, {
          type: "tool_result",
          id: event.toolCallId,
          name: event.toolName,
          ok: !event.isError,
          summary,
        });
        return;
      }
      case "agent_end": {
        sse(controller, { type: "end" });
        onEnd();
        return;
      }
    }
  });
}

function isGated(
  toolName: string,
  autoApproveTools: string[],
  requireApproval: string[],
): boolean {
  if (!requireApproval.includes(toolName)) return false;
  if (autoApproveTools.includes(toolName)) return false;
  return true;
}

/**
 * Entry point for a fresh /api/chat POST when SAHAYAK_LLM_BACKEND=pi.
 *
 * Doesn't await the Agent's run — the event translator closes the stream
 * when `agent_end` fires. On a gated tool call, `beforeToolCall` writes
 * `tool_approval_required`, closes the current stream, and awaits the
 * decision promise. The Agent keeps running in-process; `resumePiRun`
 * rebinds the translator to a new response stream and resolves the
 * decision.
 */
export async function startPiRun(
  input: PiRunInput,
  controller: Controller,
): Promise<void> {
  sweep();
  const model = piModelForOllama(input.model);
  const tools = piToolsFromEnabled(input.enabledTools);
  const messages = await toPiMessages(input.clientMessages);
  // Mutable in place so resume's splice(0, ..., list) is visible to
  // beforeToolCall's isGated() check on the next pause.
  const approvalState = {
    autoApproveTools: [...input.autoApproveTools],
    requireApproval: [...input.requireApproval],
  };

  // Ref cell so beforeToolCall writes to the currently-bound stream and
  // resume can swap it without touching the Agent closure.
  const ctrl: { current: Controller; unsub: (() => void) | null } = {
    current: controller,
    unsub: null,
  };
  // Shared across translator rebinds — counts LLM turns (not individual
  // tool calls) to mirror the native path's maxToolTurns cap.
  const turnState = {
    turnCount: 0,
    maxTurns: input.maxToolTurns,
    capped: false,
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: input.systemPrompt,
      model,
      tools: tools as AgentTool[],
      thinkingLevel: piThinkLevel(input.think),
      messages,
    },
    toolExecution: "parallel",
    getApiKey: () => "ollama",
    beforeToolCall: async (
      ctxBefore: BeforeToolCallContext,
    ): Promise<BeforeToolCallResult | undefined> => {
      const { toolCall } = ctxBefore;
      if (
        !isGated(
          toolCall.name,
          approvalState.autoApproveTools,
          approvalState.requireApproval,
        )
      ) {
        return undefined;
      }
      const token = nanoid(16);
      sse(ctrl.current, {
        type: "tool_approval_required",
        token,
        toolName: toolCall.name,
        arguments: (toolCall as ToolCall).arguments,
        index: 0,
      });

      const decision = await new Promise<Decision>((resolve) => {
        pending.set(token, {
          agent,
          resolve,
          autoApproveTools: approvalState.autoApproveTools,
          requireApproval: approvalState.requireApproval,
          createdAt: Date.now(),
        });
        // Tear down the active subscriber and close the current stream so
        // the client's fetch resolves. The Agent is still awaiting this
        // promise in-process.
        if (ctrl.unsub) {
          ctrl.unsub();
          ctrl.unsub = null;
        }
        safeClose(ctrl.current);
      });

      pending.delete(token);

      if (decision === "deny") {
        return {
          block: true,
          reason: `The user declined to approve the ${toolCall.name} call.`,
        };
      }
      if (decision === "cancel") {
        agent.abort();
        return { block: true, reason: "user_cancelled" };
      }
      return undefined;
    },
  });

  const rebind = (c: Controller) => {
    if (ctrl.unsub) ctrl.unsub();
    ctrl.current = c;
    ctrl.unsub = attachTranslator(agent, c, turnState, () => {
      // agent_end fired: drop our subscriber, close the live stream, clean
      // up the run-state entry. Pending map is already cleaned by the
      // beforeToolCall post-await step.
      if (ctrl.unsub) {
        ctrl.unsub();
        ctrl.unsub = null;
      }
      safeClose(ctrl.current);
      runStateByAgent.delete(agent);
    });
  };

  runStateByAgent.set(agent, { rebind });
  rebind(controller);

  // Fire the run. `continue()` because our transcript already includes the
  // latest user message — we don't want to double-append it. The subscriber
  // closes the stream on agent_end; runtime errors surface as SSE `error`.
  agent.continue().catch((e) => {
    sse(ctrl.current, { type: "error", message: (e as Error).message });
    if (ctrl.unsub) {
      ctrl.unsub();
      ctrl.unsub = null;
    }
    safeClose(ctrl.current);
    runStateByAgent.delete(agent);
  });
}

/**
 * Entry point for /api/chat/resume when SAHAYAK_LLM_BACKEND=pi. The Agent
 * is still running in-memory waiting on a decision promise; we rebind our
 * SSE translator to this new response's controller, update the
 * autoApproveTools allowlist, and resolve the decision.
 */
export async function resumePiRun(
  token: string,
  decision: Decision,
  autoApproveTools: string[] | undefined,
  controller: Controller,
): Promise<void> {
  sweep();
  const entry = pending.get(token);
  if (!entry) {
    sse(controller, {
      type: "error",
      message: "no pending approval for token (expired or already resolved)",
    });
    safeClose(controller);
    return;
  }

  if (autoApproveTools) {
    // Extend the live allowlist in place; the Agent's closure reads this
    // on its next isGated() check.
    entry.autoApproveTools.splice(
      0,
      entry.autoApproveTools.length,
      ...autoApproveTools,
    );
  }

  const run = runStateByAgent.get(entry.agent);
  if (!run) {
    sse(controller, {
      type: "error",
      message: "agent state lost for token (server restarted?)",
    });
    safeClose(controller);
    return;
  }

  // Bind the new stream BEFORE resolving so subsequent events flow through
  // it and nothing races.
  run.rebind(controller);
  entry.resolve(decision);
}

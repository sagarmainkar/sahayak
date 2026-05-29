/**
 * delegate_to_worker — manager delegates a self-contained subtask to a
 * cheaper worker model. The worker runs as a sub-Agent with the same
 * tools, stateless. Tool calls and content stream through the existing
 * SSE channel with `source: "worker"` so the UI can render them nested.
 *
 * ## Architecture
 * - Tool handler reads WorkerContext from workerRegistry (keyed by sessionId).
 * - Creates a fresh Agent for the worker model.
 * - Subscribes to worker events → forwards to the main SSE controller.
 * - Supports abort: the registry's activeWorker is set on start and checked
 *   by the main job's abort path.
 * - Turn cap: 50 tool-calling turns enforced in the event subscriber.
 * - Recursion guard: delegate_to_worker is filtered from the worker's tools.
 * - Approval: gated tools pause via the registry's approvalHandler (reuses
 *   the same pending map + approve API as the manager).
 *
 * ## Persistence
 * Returns a condensed `workerLog` (one entry per content batch / tool
 * call / tool result) alongside the final output. The caller persists
 * only manager-level tool_call + tool_result; workerLog is rendered as
 * an expandable section in the UI.
 */

import { Agent } from "@mariozechner/pi-agent-core";
import type {
  AgentEvent,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@mariozechner/pi-agent-core";
import type { ToolCall } from "@mariozechner/pi-ai";
import {
  piModelForBedrock,
  piModelForOllama,
  piModelForOpenAICompat,
  piToolsFromEnabled,
} from "@/lib/piAdapters";
import { IMPLICIT_TOOL_NAMES } from "@/lib/tools";
import type { ToolSpec, ToolResult } from "@/lib/tools/types";
import { err, ok } from "@/lib/tools/types";
import { readUpload } from "@/lib/uploads";
import type { UploadScope } from "@/lib/uploads";
import {
  getWorkerContext,
  DEFAULT_WORKER_SYSTEM_PROMPT,
} from "@/lib/workerRegistry";

// ── Helpers ────────────────────────────────────────────────────────────

type Controller = ReadableStreamDefaultController<Uint8Array> | null;

function sse(ctrl: Controller | null, obj: Record<string, unknown>) {
  if (!ctrl) return;
  const data = JSON.stringify(obj);
  ctrl.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
}

/** One entry in the condensed worker log persisted alongside the result. */
export type WorkerLogEntry = {
  type: string;
  name?: string;
  summary: string;
};

/** Hard cap on worker tool-calling turns to prevent infinite loops. */
const WORKER_MAX_TURNS = 100;

// ── Tool spec ──────────────────────────────────────────────────────────

export const delegateToWorkerSpec: ToolSpec = {
  name: "delegate_to_worker",
  group: "delegation",
  description:
    "Delegate a self-contained subtask to a cheaper worker model. " +
    "Use for heavy analysis, multi-file code generation, or multi-step " +
    "research. The worker has the same tools as you. Its progress is " +
    "visible in the chat. You are responsible for the final answer.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Clear, specific task for the worker. Include all " +
          "context the worker needs — it has no memory of the conversation.",
      },
      files: {
        type: "array",
        description:
          "Array of file paths the worker should read. Each item is a " +
          "session-relative path (e.g. 'uploads/data.csv'). Optional.",
      },
      refine: {
        type: "string",
        description:
          "Previous worker output to improve. When set, the worker sees its " +
          "prior attempt alongside the new prompt and produces a targeted " +
          "refinement instead of starting from scratch. Use when Self-check " +
          "shows LOW confidence or PARTIAL completeness.",
      },
    },
    required: ["prompt"],
  },

  handler: async (
    args: Record<string, unknown>,
    ctx?: { assistantId: string; sessionId: string },
  ): Promise<ToolResult> => {
    const prompt = String(args.prompt ?? "");
    const filePaths = Array.isArray(args.files)
      ? (args.files as string[])
      : [];
    const sessionId = ctx?.sessionId;
    if (!sessionId) {
      return err("no_session", "delegate_to_worker requires a session scope");
    }

    const wc = getWorkerContext(sessionId);
    if (!wc) {
      return err(
        "no_worker_context",
        "Worker context not found for this session. " +
          "The assistant may not have a worker configured.",
      );
    }

    // Enforce maxParallel cap before spinning up a new worker.
    const maxParallel = wc.maxParallel ?? 1;
    if (wc.activeWorkers.size >= maxParallel) {
      return err(
        "worker_at_capacity",
        `All ${maxParallel} worker slot(s) are currently busy. ` +
          (maxParallel === 1
            ? "Workers run sequentially — wait for the current worker to finish before delegating again."
            : `Wait for a worker to finish before delegating more. (maxParallel=${maxParallel})`),
      );
    }

    // Unique id for this delegation — used for abort-identity checks
    // and to tag worker SSE events so the UI can show parallel workers distinctly.
    const delegationId = Math.random().toString(36).slice(2, 10);

    // ── Resolve worker model ──────────────────────────────────────────
    const workerProvider = wc.workerConfig.provider ?? "ollama";
    const workerModel =
      workerProvider === "bedrock"
        ? piModelForBedrock(
            wc.workerConfig.model,
            wc.workerConfig.bedrockRegion,
          )
        : workerProvider === "llama-cpp"
          ? piModelForOpenAICompat(
              wc.workerConfig.llamaUrl ?? "http://localhost:8080/v1",
              wc.workerConfig.model,
              "llama-cpp",
            )
          : piModelForOllama(wc.workerConfig.model);

    // ── Build worker tool set (exclude delegate_to_worker) ────────────
    const scope: UploadScope = {
      assistantId: ctx.assistantId,
      sessionId: ctx.sessionId,
    };

    // Recursion guard: worker can't delegate to another worker.
    const workerEnabledTools = wc.enabledTools.filter(
      (t) => t !== "delegate_to_worker",
    );
    const workerTools = await piToolsFromEnabled(workerEnabledTools, scope);
    const workerApprovalState = wc.approvalState;

    // ── Read files ─────────────────────────────────────────────────────
    let fileContents = "";
    if (filePaths.length > 0) {
      for (const fp of filePaths) {
        try {
          const data = await readUpload(scope, String(fp));
          if (data) {
            const text = Buffer.from(data.buffer).toString("utf-8").slice(0, 8000);
            fileContents += `\n\n--- File: ${fp} ---\n${text}`;
          } else {
            fileContents += `\n\n--- File: ${fp} (not found or empty) ---`;
          }
        } catch (e) {
          fileContents += `\n\n--- File: ${fp} (error reading: ${(e as Error).message}) ---`;
        }
      }
    }

    const workerSystemPrompt =
      wc.workerConfig.systemPrompt || DEFAULT_WORKER_SYSTEM_PROMPT;

    // If the manager is asking for a refinement, prepend the previous
    // attempt so the worker can improve on it without starting over.
    const refineText = typeof args.refine === "string" && args.refine.trim()
      ? `## Previous attempt (needs improvement)\n${args.refine.trim()}\n\n## What to fix / improve\n`
      : "";

    const fullUserPrompt = [refineText + prompt, fileContents].filter(Boolean).join("\n\n");

    // ── Create worker Agent ────────────────────────────────────────────
    const agent = new Agent({
      initialState: {
        systemPrompt: workerSystemPrompt,
        model: workerModel,
        tools: workerTools as AgentTool[],
        thinkingLevel: "medium",
        messages: [{ role: "user", content: fullUserPrompt, timestamp: Date.now() }],
      },
      toolExecution: "parallel",
      getApiKey: () =>
        workerProvider === "bedrock" ? "bedrock" : "ollama",

      beforeToolCall: async (
        c: BeforeToolCallContext,
      ): Promise<BeforeToolCallResult | undefined> => {
        const { toolCall } = c;
        // Implicit tools (remember, ask_user, etc.) are never gated.
        if (IMPLICIT_TOOL_NAMES.has(toolCall.name)) return undefined;
        // Mirror the manager's isGated() logic: autoApproveTools is the ONLY
        // gate. requireApproval is the initial "needs first-time consent" list —
        // once the user has approved a tool (it lands in autoApproveTools) the
        // worker must NOT re-ask. Using requireApproval as a second condition
        // caused the worker to always prompt because DEFAULT_REQUIRE_APPROVAL
        // is ALL_TOOLS, making !requireApproval permanently false.
        if (workerApprovalState.autoApproveTools.includes(toolCall.name))
          return undefined;

        // Send approval request through the manager's SSE stream.
        const decision = await wc.requestApproval(
          {
            toolName: toolCall.name,
            arguments: (toolCall as ToolCall).arguments as Record<string, unknown>,
          },
          agent,
        );

        if (decision === "deny") {
          return {
            block: true,
            reason: `The user declined to approve the worker's ${toolCall.name} call.`,
          };
        }
        if (decision === "cancel") {
          agent.abort();
          return { block: true, reason: "user_cancelled" };
        }
        // Remember this approval so the worker won't ask for the same
        // tool again this delegation. Shares the array with the manager's
        // context so manager-approved tools also propagate to the worker.
        if (!workerApprovalState.autoApproveTools.includes(toolCall.name)) {
          workerApprovalState.autoApproveTools.push(toolCall.name);
        }
        return undefined;
      },
    });

    // ── Register for abort propagation ─────────────────────────────────
    wc.activeWorkers.set(delegationId, agent);

    // ── Worker event subscriber ────────────────────────────────────────
    const log: WorkerLogEntry[] = [];
    let turnCount = 0;
    let contentChunk = "";
    let contentLogged = false;
    let aborted = false;
    let finalText = "";
    let workerError: string | null = null;

    const unsub = agent.subscribe((event: AgentEvent) => {
      // Check for abort from outside (manager stopped, or session ended).
      if (!wc.activeWorkers.has(delegationId)) {
        aborted = true;
        agent.abort();
        return;
      }

      if (event.type === "message_update") {
        const me = event.assistantMessageEvent;
        if (me.type === "text_delta") {
          sse(wc.controller, {
            type: "content",
            source: "worker",
            workerId: delegationId,
            delta: me.delta,
          });
          contentChunk += me.delta;
        } else if (me.type === "thinking_delta") {
          sse(wc.controller, {
            type: "thinking",
            source: "worker",
            workerId: delegationId,
            delta: me.delta,
          });
        }
        return;
      }

      if (event.type === "message_end") {
        // Log the content batch accumulated since the last message_end
        // or tool_execution_start. Reset after logging so the next
        // batch (possibly without an intervening tool call) is captured.
        if (contentChunk) {
          log.push({
            type: "content",
            summary:
              contentChunk.slice(0, 120) +
              (contentChunk.length > 120 ? "…" : ""),
          });
        }
        contentChunk = "";
        contentLogged = false;
        // Extract final text from the assistant message
        const msg = event.message as any;
        const parts: string[] = [];
        if (typeof msg.content === "string") parts.push(msg.content);
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block?.text) parts.push(block.text);
          }
        }
        finalText = parts.join("\n");
        return;
      }

      if (event.type === "tool_execution_start") {
        turnCount++;
        if (turnCount > WORKER_MAX_TURNS) {
          workerError = `Worker exceeded ${WORKER_MAX_TURNS} tool turns`;
          agent.abort();
          return;
        }
        sse(wc.controller, {
          type: "tool_call",
          source: "worker",
          workerId: delegationId,
          name: event.toolName,
          arguments: event.args,
        });
        const argsStr = JSON.stringify(event.args);
        log.push({
          type: "tool_call",
          name: event.toolName,
          summary: argsStr.slice(0, 120) + (argsStr.length > 120 ? "…" : ""),
        });
        contentChunk = "";
        contentLogged = false;
        return;
      }

      if (event.type === "tool_execution_end") {
        const resultStr = JSON.stringify(event.result ?? {});
        sse(wc.controller, {
          type: "tool_result",
          source: "worker",
          name: event.toolName,
          result: event.result,
        });
        log.push({
          type: "tool_result",
          name: event.toolName,
          summary:
            resultStr.slice(0, 200) + (resultStr.length > 200 ? "…" : ""),
        });
        return;
      }

      if (event.type === "agent_end") {
        // Normal completion — final text already captured in message_end.
      }
    });

    // ── Run worker ─────────────────────────────────────────────────────
    try {
      await agent.continue();
    } catch (e) {
      if (!aborted) {
        workerError = (e as Error).message;
      }
    }

    // ── Clean up ───────────────────────────────────────────────────────
    unsub();
    wc.activeWorkers.delete(delegationId);

    // ── Build result ───────────────────────────────────────────────────
    if (aborted) {
      return err("worker_aborted", "Worker was stopped", {
        output: finalText || undefined,
        workerLog: log,
      });
    }

    if (workerError) {
      return err("worker_error", workerError, {
        output: finalText || undefined,
        workerLog: log,
      });
    }

    if (turnCount >= WORKER_MAX_TURNS && !finalText) {
      return err(
        "worker_turn_limit",
        `Worker hit ${WORKER_MAX_TURNS}-turn cap without producing output`,
        { workerLog: log },
      );
    }

    return ok({
      output: finalText || "(worker produced no output)",
      workerLog: log,
    });
  },
};

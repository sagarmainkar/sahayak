/** Per-session bridge between the tool handler and the streaming Agent.
 *
 *  pi-agent-core's tool handler signature is `(args, ctx)` — no access
 *  to the SSE controller or the current run's tool/approval config.
 *  This module stores that context under the sessionId key before the
 *  Agent starts, and the `delegate_to_worker` handler reads it at call
 *  time. Cleaned up when the Agent terminates or aborts.
 */

import type { AssistantProvider } from "@/lib/types";

type Controller = ReadableStreamDefaultController<Uint8Array> | null;

type Decision = "approve" | "deny" | "cancel";

/** Approval request the worker sends to the user through the manager's
 *  SSE stream. Resolved when the user clicks approve/deny/cancel. */
export type WorkerApprovalRequest = {
  toolName: string;
  arguments: Record<string, unknown>;
};

export type WorkerContext = {
  /** SSE controller for forwarding worker events to the client. */
  controller: Controller;
  /** Tools enabled for this session (used to create the worker's tool set). */
  enabledTools: string[];
  /** Session scope — needed by the worker's tool handlers. */
  scope: { assistantId: string; sessionId: string };
  /** Approval state to replicate manager's gating rules in the worker. */
  approvalState: {
    autoApproveTools: string[];
    requireApproval: string[];
  };
  /** Worker model + provider configuration. */
  workerConfig: {
    model: string;
    provider?: AssistantProvider;
    llamaUrl?: string;
    bedrockRegion?: string;
    systemPrompt?: string;
  };
  /** Reference to the active worker sub-Agent. Set by the tool handler
   *  when the worker starts; cleared when it finishes. The main job's
   *  abort path reads this to propagate Stop to the worker. */
  activeWorker: { abort: () => void } | null;
  /** Request tool-call approval from the user through the manager's
   *  SSE stream. Returns the user's decision. */
  requestApproval: (
    req: WorkerApprovalRequest,
    workerAgent: { abort: () => void },
  ) => Promise<Decision>;
  /** Background job id — set when running via jobRunner; undefined for
   *  direct /api/chat. Used by requestApproval to delegate to the
   *  job's pendingApproval mechanism. */
  jobId?: string;
};

const registry = new Map<string, WorkerContext>();

/** Set the worker context for a session before the Agent starts. */
export function setWorkerContext(sessionId: string, ctx: WorkerContext): void {
  registry.set(sessionId, ctx);
}

/** Read the worker context from within the delegate_to_worker handler. */
export function getWorkerContext(sessionId: string): WorkerContext | undefined {
  return registry.get(sessionId);
}

/** Clean up after the Agent terminates or aborts. */
export function clearWorkerContext(sessionId: string): void {
  registry.delete(sessionId);
}

/** Default system prompt for the worker sub-Agent when the assistant
 *  doesn't provide a custom one. */
export const DEFAULT_WORKER_SYSTEM_PROMPT = `You are a worker agent assisting a manager AI. Complete the specific task given to you and report back clearly.

- You have access to the same tools as the manager (read_file, bash, web_search, etc.).
- Include your reasoning and methodology — the manager may ask how you reached your conclusion.
- Be thorough but concise. Include relevant details, file paths, and code snippets.
- Use markdown. Code in triple-backtick fences with language tags.
- If you encounter errors, explain what went wrong and what you tried.
- You are stateless — all context you need is in this prompt.`;

/** System prompt augmentation injected into the manager's system prompt
 *  when a worker is configured. */
export function workerSystemPromptAugmentation(modelName: string): string {
  return `

## Worker delegation

You have a worker model (\`${modelName}\`) available via \`delegate_to_worker\`. Use it to offload self-contained heavy work while you focus on orchestration.

The worker has the same tools as you (read_file, bash, web_search, etc.). Its tool calls and output are visible in the chat — monitor its progress.

**Delegate when:**
- Large code generation or refactoring
- Analysis of multiple files or large datasets
- Multi-step research tasks
- Any task that is self-contained (doesn't need your conversation history)

**Don't delegate:**
- Simple one-step tasks — just do them yourself
- Tasks requiring conversation context the worker doesn't have
- User-facing responses — you write those

**How to delegate:**
- Call \`delegate_to_worker\` with a clear, specific prompt
- Include file paths the worker should read (optional)
- Review the worker's output before using it
- If unsatisfied, re-delegate with refinements or handle it yourself
- If the worker returns an error with partial output, you may use the partial output and complete the task yourself

You are responsible for the final answer. The worker is a helper, not a replacement.`;
}

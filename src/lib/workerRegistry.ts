/** Per-session bridge between the tool handler and the streaming Agent.
 *
 *  pi-agent-core's tool handler signature is `(args, ctx)` — no access
 *  to the SSE controller or the current run's tool/approval config.
 *  This module stores that context under the sessionId key before the
 *  Agent starts, and the `delegate_to_worker` handler reads it at call
 *  time. Cleaned up when the Agent terminates or aborts.
 */

import type { AssistantProvider } from "@/lib/types";

type Controller = ReadableStreamDefaultController<Uint8Array>;

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

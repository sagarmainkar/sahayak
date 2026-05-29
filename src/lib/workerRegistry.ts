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
  /** Map of currently running worker sub-Agents, keyed by delegationId.
   *  Supports concurrent workers up to maxParallel. The main job's
   *  abort path iterates this map to propagate Stop to all workers. */
  activeWorkers: Map<string, { abort: () => void }>;
  /** Maximum number of concurrent workers allowed. Default 1 (sequential). */
  maxParallel: number;
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

You have access to the same tools as the manager (read_file, execute_command, web_search, etc.).
You are stateless — all context you need is in this prompt.

## Task type
Your prompt may begin with one of these tags — adjust your approach accordingly:
- [RESEARCH]  — web search, fact-gathering, summarisation. Be concise, cite sources, flag uncertainty.
- [CODE]      — read/analyse/write code. Match existing style. Show targeted diffs not full files. Verify claims against actual source.
- [WRITE]     — produce docs, reports, structured output. Use the exact format requested. No padding.
- [VERIFY]    — check a claim against real files/data. State verdict first (CONFIRMED / REFUTED / INCONCLUSIVE), then evidence.
If no tag is present, infer the type from the prompt and apply the closest approach.

## Refinement
If the prompt contains a "Previous attempt" section, you are being asked to improve on prior work.
Read what was wrong or missing, then produce a better version — do not start from scratch.

## Output format
Structure every response as:

### Summary  (max 150 words — dense and actionable)
[Key findings the manager needs to act on. No filler.]

### Details  (only if the task warrants it)
[Full analysis, code snippets, file paths, evidence.]

The manager reads Summary first. Keep it tight.

## Self-check  (always include this section at the end)
- Confidence: HIGH / MEDIUM / LOW
- Completeness: YES / PARTIAL — [what is missing if partial]
- Verified: did you check your findings against actual files/data/output? YES / NO`;

/** System prompt augmentation injected into the manager's system prompt
 *  when a worker is configured. Reflects the actual maxParallel setting
 *  so the manager LLM knows exactly what concurrency is allowed. */
export function workerSystemPromptAugmentation(modelName: string, maxParallel: number = 1): string {
  const concurrencyNote =
    maxParallel === 1
      ? `**Workers run sequentially.** Call \`delegate_to_worker\` one at a time — wait for the result before calling again. Do not call it multiple times in a single turn.`
      : `**You can run up to ${maxParallel} workers in parallel.** You MAY call \`delegate_to_worker\` up to ${maxParallel} times in a single turn. Each worker is independent and stateless. Do not exceed ${maxParallel} concurrent delegations.`;

  return `

## Worker delegation

You have a worker model (\`${modelName}\`) available via \`delegate_to_worker\`. Use it to offload self-contained heavy work while you focus on orchestration.

The worker has the same tools as you (read_file, bash, web_search, etc.). Its tool calls and output are visible in the chat — monitor its progress.

${concurrencyNote}

**Delegate when:**
- Large code generation or refactoring
- Analysis of multiple files or large datasets
- Multi-step research tasks
- Any self-contained task that does not need conversation history

**Don't delegate:**
- Simple one-step tasks — do them yourself
- Tasks requiring conversation context the worker doesn't have
- Final synthesis or user-facing responses — you write those

**How to write a good worker prompt:**
- Prefix with task type: [RESEARCH], [CODE], [WRITE], or [VERIFY]
- Be directive, not verbose — the worker has the same tools and can read files itself
- Use the \`files\` parameter to pre-load files instead of pasting content inline
- Good: "[CODE] Read src/lib/toolLoopPi.ts — extract the approval flow and isGated() logic"
- Bad:  "Here is toolLoopPi.ts: [2000 tokens of content]... now analyse it"

**Reviewing worker output:**
- Every worker response ends with a Self-check section (Confidence, Completeness, Verified)
- HIGH + complete  → use the Summary directly; read Details only if you need depth
- LOW or PARTIAL   → use the \`refine\` parameter to improve without full re-delegation:
    delegate_to_worker { prompt: "[what to fix]", refine: "[previous output]" }

You are responsible for the final answer. The worker is a helper, not a replacement.`;
}
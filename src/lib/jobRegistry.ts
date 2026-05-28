import { nanoid } from "nanoid";

export type JobStatus = "running" | "paused" | "completed" | "failed" | "aborted";

export type JobEvent = {
  id: number;
  data: Record<string, unknown>;
};

export type JobApprovalRequest = {
  token: string;
  toolName: string;
  arguments: Record<string, unknown>;
  resolve: (decision: "approve" | "deny" | "cancel") => void;
};

export type JobUserInputRequest = {
  token: string;
  question: string;
  options: string[];
  resolve: (answer: string) => void;
};

export type Job = {
  id: string;
  assistantId: string;
  sessionId: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  events: JobEvent[];
  subscribers: Set<(event: JobEvent) => void>;
  pendingApproval: JobApprovalRequest | null;
  pendingUserInput: JobUserInputRequest | null;
  abort: (() => void) | null;
  autoApproveTools: string[];
};

const jobs = new Map<string, Job>();

const JOB_TTL_MS = 30 * 60 * 1000;

/** Hard cap on stored events per job. Character-level deltas produce
 *  thousands of events per turn — without this, multi-turn sessions
 *  accumulate 50K+ events and replay on reconnect blocks the Node.js
 *  event loop (which also blocks abort/Stop handling). */
const MAX_JOB_EVENTS = 2000;

function sweep() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (
      (job.status === "completed" || job.status === "failed" || job.status === "aborted") &&
      job.updatedAt < cutoff
    ) {
      jobs.delete(id);
    }
  }
}

export function createJob(
  assistantId: string,
  sessionId: string,
  autoApproveTools: string[] = []
): Job {
  sweep();
  const job: Job = {
    id: nanoid(12),
    assistantId,
    sessionId,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
    subscribers: new Set(),
    pendingApproval: null,
    pendingUserInput: null,
    abort: null,
    autoApproveTools,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | null {
  sweep();
  return jobs.get(id) ?? null;
}

export function listJobs(): Job[] {
  sweep();
  return Array.from(jobs.values());
}

export function listActiveJobs(): Job[] {
  sweep();
  return Array.from(jobs.values()).filter(
    (j) => j.status === "running" || j.status === "paused"
  );
}

/** Monotonically-increasing event id across all jobs. Using a global
 *  counter instead of array length means ids stay valid even after the
 *  ring buffer evicts old entries. */
let nextEventId = 0;

export function appendEvent(jobId: string, data: Record<string, unknown>): void {
  const job = jobs.get(jobId);
  if (!job) return;

  const event: JobEvent = { id: nextEventId++, data };
  job.events.push(event);

  // Streaming produces thousands of character-level content/thinking
  // deltas per turn. Those are only useful during LIVE streaming —
  // for replay (reconnect) they're dead weight. When a turn completes
  // (assistant_message carries the full text, done_turn has the token
  // counts), prune intermediate deltas so the replay buffer only holds
  // structural events (tool_call, tool_result, assistant_message, etc.).
  const type = data.type as string;
  if (type === "assistant_message" || type === "done_turn") {
    job.events = job.events.filter((e) => {
      const t = e.data.type as string;
      return t !== "content" && t !== "thinking";
    });
  }

  // Ring buffer safety cap — should rarely trigger after pruning,
  // but prevents runaway growth from long tool chains.
  while (job.events.length > MAX_JOB_EVENTS) {
    job.events.shift();
  }

  job.updatedAt = Date.now();
  for (const cb of job.subscribers) {
    cb(event);
  }
}

export function subscribe(
  jobId: string,
  fromEventId: number,
  cb: (event: JobEvent) => void
): (() => void) | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  // If the client is reconnecting from an id older than our ring
  // buffer, start from the oldest available event rather than
  // trying (and failing) to replay ancient history. The client
  // already has the full session persisted via JSONL so it can
  // reconstruct any gap on next page load.
  const oldestId = job.events[0]?.id ?? 0;
  const effectiveFrom = Math.max(fromEventId, oldestId);
  for (const event of job.events) {
    if (event.id >= effectiveFrom) {
      cb(event);
    }
  }
  job.subscribers.add(cb);
  return () => {
    job.subscribers.delete(cb);
  };
}

export function setJobStatus(jobId: string, status: JobStatus): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.updatedAt = Date.now();
}

export function setJobAbort(jobId: string, fn: () => void): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.abort = fn;
}

export function abortJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.abort) {
    job.abort();
  }
  job.status = "aborted";
  job.updatedAt = Date.now();
  appendEvent(jobId, { type: "end", reason: "aborted" });
  return true;
}

export function pauseForApproval(
  jobId: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<"approve" | "deny" | "cancel"> {
  return new Promise((resolve) => {
    const job = jobs.get(jobId);
    if (!job) {
      resolve("cancel");
      return;
    }
    job.pendingApproval = { token, toolName, arguments: args, resolve };
    job.status = "paused";
    job.updatedAt = Date.now();
  });
}

export function resolveApproval(
  jobId: string,
  decision: "approve" | "deny" | "cancel"
): boolean {
  const job = jobs.get(jobId);
  if (!job || !job.pendingApproval) return false;
  const { resolve } = job.pendingApproval;
  job.pendingApproval = null;
  job.status = "running";
  job.updatedAt = Date.now();
  resolve(decision);
  return true;
}

export function pauseForUserInput(
  jobId: string,
  token: string,
  question: string,
  options: string[],
): Promise<string> {
  return new Promise((resolve) => {
    const job = jobs.get(jobId);
    if (!job) {
      resolve("");
      return;
    }
    job.pendingUserInput = { token, question, options, resolve };
    job.status = "paused";
    job.updatedAt = Date.now();
  });
}

export function resolveUserInput(jobId: string, answer: string): boolean {
  const job = jobs.get(jobId);
  if (!job || !job.pendingUserInput) return false;
  const { resolve } = job.pendingUserInput;
  job.pendingUserInput = null;
  job.status = "running";
  job.updatedAt = Date.now();
  resolve(answer);
  return true;
}

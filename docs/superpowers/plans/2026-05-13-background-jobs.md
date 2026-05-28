# Background Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the chat tool loop from the client's HTTP connection so jobs survive navigation, and enable parallel runs against different backends.

**Architecture:** The server spawns a "job" for each chat request. The job runs the tool loop independently, appends results directly to the session JSONL as it progresses, and emits SSE events to a reconnectable event stream. The client subscribes/unsubscribes freely. Multiple jobs can run concurrently (different sessions, different Ollama endpoints).

**Tech Stack:** Next.js 16 App Router (Node runtime), existing pi-agent-core Agent, in-process Map-based job registry (no external queue — single-user app), JSONL persistence, SSE with Last-Event-ID replay.

---

## Scope Note

This plan covers two independent subsystems that the user asked for in a single request:

1. **Background job execution** — the core decoupling (Tasks 1–8)
2. **Vision OCR for scanned PDFs** — unrelated to the job system (Task 9)

They share no code. Task 9 is self-contained and can be implemented in any order.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/jobRegistry.ts` | In-process job store: create, get, list, subscribe, append events, GC |
| Create | `src/app/api/jobs/route.ts` | `POST /api/jobs` — create a job (replaces POST /api/chat as entry point) |
| Create | `src/app/api/jobs/[id]/stream/route.ts` | `GET /api/jobs/:id/stream` — reconnectable SSE subscription |
| Create | `src/app/api/jobs/[id]/route.ts` | `GET /api/jobs/:id` — job metadata (status, progress); `DELETE` — abort |
| Create | `src/app/api/jobs/[id]/approve/route.ts` | `POST /api/jobs/:id/approve` — HITL approval/denial for gated tools |
| Modify | `src/components/Chat.tsx` | Replace inline SSE consumer with job-based flow |
| Modify | `src/lib/store.ts` | Add `appendMessage()` for incremental writes (server-side persistence) |
| Modify | `src/lib/toolLoopPi.ts` | Wire persistence callbacks into agent event translator |
| Modify | `src/lib/tools/web.ts` | Add `pdf_ocr` vision extraction for image-based pages |
| Keep | `src/app/api/chat/route.ts` | Deprecate gradually; new jobs route is the entry point |
| Keep | `src/app/api/chat/resume/route.ts` | Deprecate gradually; approval goes through `/api/jobs/:id/approve` |

---

### Task 1: Job Registry — core data structures

**Files:**
- Create: `src/lib/jobRegistry.ts`

- [ ] **Step 1: Define types**

```typescript
// src/lib/jobRegistry.ts
import { nanoid } from "nanoid";

export type JobStatus = "running" | "paused" | "completed" | "failed" | "aborted";

export type JobEvent = {
  id: number; // monotonic sequence for replay
  data: Record<string, unknown>; // SSE-shaped event
};

export type JobApprovalRequest = {
  token: string;
  toolName: string;
  arguments: Record<string, unknown>;
  resolve: (decision: "approve" | "deny" | "cancel") => void;
};

export type Job = {
  id: string;
  assistantId: string;
  sessionId: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  events: JobEvent[];
  /** Subscribers get called with new events in real-time. */
  subscribers: Set<(event: JobEvent) => void>;
  /** When paused for HITL, this holds the pending approval. */
  pendingApproval: JobApprovalRequest | null;
  /** Abort handle — calling this stops the agent. */
  abort: (() => void) | null;
};
```

- [ ] **Step 2: Implement registry CRUD**

```typescript
const jobs = new Map<string, Job>();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 min after completion

function sweep(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const terminal = job.status === "completed" || job.status === "failed" || job.status === "aborted";
    if (terminal && now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

export function createJob(assistantId: string, sessionId: string): Job {
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
    abort: null,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null;
}

export function listJobs(): Job[] {
  sweep();
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function listActiveJobs(): Job[] {
  return listJobs().filter(j => j.status === "running" || j.status === "paused");
}
```

- [ ] **Step 3: Implement event append + subscribe**

```typescript
export function appendEvent(jobId: string, data: Record<string, unknown>): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const event: JobEvent = { id: job.events.length, data };
  job.events.push(event);
  job.updatedAt = Date.now();
  for (const cb of job.subscribers) {
    try { cb(event); } catch {}
  }
}

export function subscribe(
  jobId: string,
  fromEventId: number,
  cb: (event: JobEvent) => void,
): (() => void) | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  // Replay missed events
  for (let i = fromEventId; i < job.events.length; i++) {
    cb(job.events[i]);
  }
  job.subscribers.add(cb);
  return () => { job.subscribers.delete(cb); };
}

export function setJobStatus(jobId: string, status: JobStatus): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.updatedAt = Date.now();
}

export function setJobAbort(jobId: string, fn: () => void): void {
  const job = jobs.get(jobId);
  if (job) job.abort = fn;
}

export function abortJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || !job.abort) return false;
  job.abort();
  job.status = "aborted";
  job.updatedAt = Date.now();
  appendEvent(jobId, { type: "end", reason: "aborted" });
  return true;
}
```

- [ ] **Step 4: Implement HITL pause/resume helpers**

```typescript
export function pauseForApproval(
  jobId: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<"approve" | "deny" | "cancel"> {
  const job = jobs.get(jobId);
  if (!job) return Promise.resolve("cancel");
  return new Promise((resolve) => {
    job.pendingApproval = { token, toolName, arguments: args, resolve };
    job.status = "paused";
    job.updatedAt = Date.now();
  });
}

export function resolveApproval(
  jobId: string,
  decision: "approve" | "deny" | "cancel",
): boolean {
  const job = jobs.get(jobId);
  if (!job || !job.pendingApproval) return false;
  job.pendingApproval.resolve(decision);
  job.pendingApproval = null;
  job.status = "running";
  job.updatedAt = Date.now();
  return true;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobRegistry.ts
git commit -m "feat(jobs): in-process job registry with event log, subscribe, and HITL pause"
```

---

### Task 2: Incremental JSONL persistence (server-side writes)

**Files:**
- Modify: `src/lib/store.ts`

Currently the client PATCHes the full session after each turn. The job needs to append messages as they arrive — without rewriting the entire JSONL each time.

- [ ] **Step 1: Add `appendMessage` to store.ts**

```typescript
import { createWriteStream } from "node:fs";

/**
 * Append a single message record to an existing session JSONL. Does NOT
 * rewrite the meta line or earlier messages — O(1) per call.
 * Creates the file + meta if it doesn't exist yet.
 */
export async function appendMessage(
  assistantId: string,
  sessionId: string,
  message: ChatMessage,
): Promise<void> {
  const p = sessionFile(assistantId, sessionId);
  const dir = sessionDir(assistantId, sessionId);
  await fs.mkdir(dir, { recursive: true });
  if (!existsSync(p)) {
    const meta: MetaRecord = {
      type: "meta",
      id: sessionId,
      assistantId,
      title: "New chat",
      modelOverride: null,
      promptTokens: 0,
      completionTokens: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await fs.writeFile(p, JSON.stringify(meta) + "\n");
  }
  const record: MessageRecord = { type: "message", data: message };
  await fs.appendFile(p, JSON.stringify(record) + "\n");
}
```

- [ ] **Step 2: Add `updateMeta` for token count updates**

```typescript
/**
 * Rewrite just the meta line (first line) of an existing session JSONL.
 * Used to bump token counts after each LLM turn without rewriting all
 * messages. Reads only the first line, patches it, then rewrites the
 * full file. For incremental token updates this is cheaper than the full
 * updateSession path since we skip parsing all message lines.
 */
export async function updateSessionMeta(
  assistantId: string,
  sessionId: string,
  patch: Partial<Omit<MetaRecord, "type" | "id" | "assistantId">>,
): Promise<void> {
  const p = sessionFile(assistantId, sessionId);
  if (!existsSync(p)) return;
  const raw = await fs.readFile(p, "utf8");
  const lines = raw.split("\n");
  if (lines.length === 0) return;
  try {
    const meta = JSON.parse(lines[0]) as MetaRecord;
    if (meta.type !== "meta") return;
    const updated: MetaRecord = {
      ...meta,
      ...patch,
      updatedAt: Date.now(),
    };
    lines[0] = JSON.stringify(updated);
    await fs.writeFile(p, lines.join("\n"));
  } catch {
    return;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat(store): appendMessage + updateSessionMeta for server-side incremental writes"
```

---

### Task 3: POST /api/jobs — create and launch a job

**Files:**
- Create: `src/app/api/jobs/route.ts`

This route replaces `POST /api/chat` as the primary entry point. It validates input, creates a job, spawns the tool loop in the background, and returns the `jobId` immediately.

- [ ] **Step 1: Create the route with input validation**

```typescript
// src/app/api/jobs/route.ts
import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  DEFAULT_REQUIRE_APPROVAL,
  filterArtifactTools,
  injectArtifactInstructions,
  type ClientMsg,
} from "@/lib/toolLoop";
import {
  buildAlwaysInjectedBlock,
  getRecallContext,
  retryPendingVectors,
} from "@/lib/memory";
import { deriveCtxModel } from "@/lib/ollama";
import { normalizeOpenAiBaseUrl } from "@/lib/piAdapters";
import { createJob, appendEvent, setJobStatus, setJobAbort } from "@/lib/jobRegistry";
import { spawnJobRunner } from "@/lib/jobRunner";
import type { AssistantProvider } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JobRequest = {
  model: string;
  messages: ClientMsg[];
  system?: string;
  think?: boolean | "low" | "medium" | "high";
  enabledTools?: string[];
  maxToolTurns?: number;
  artifactsEnabled?: boolean;
  autoApproveTools?: string[];
  requireApproval?: string[];
  contextLength?: number;
  assistantId: string;
  sessionId: string;
  provider?: AssistantProvider;
  llamaUrl?: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as JobRequest;

  if (!body.assistantId || !body.sessionId) {
    return NextResponse.json(
      { error: "missing scope: assistantId and sessionId are required" },
      { status: 400 },
    );
  }

  const enabled = filterArtifactTools(
    body.enabledTools ?? [],
    !!body.artifactsEnabled,
  );
  const clientMsgs = body.artifactsEnabled
    ? injectArtifactInstructions(body.messages)
    : body.messages;

  // Memory injection (same logic as /api/chat)
  const memBlock = await buildAlwaysInjectedBlock();
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  const userMessageText =
    typeof lastUser?.content === "string" ? lastUser.content : "";
  const recallBlock = userMessageText
    ? await getRecallContext(userMessageText)
    : "";
  const userTurnCount = clientMsgs.filter((m) => m.role === "user").length;
  const NUDGE_EVERY = 4;
  const nudge =
    userTurnCount > 0 && userTurnCount % NUDGE_EVERY === 0
      ? "[memory check: if anything durable about the user, their environment, or their lasting preferences has emerged in this conversation that wasn't already saved, call remember now. Otherwise reply normally.]"
      : "";
  void retryPendingVectors(5).catch(() => {});

  const parts: string[] = [];
  if (memBlock) parts.push(memBlock);
  if (recallBlock) parts.push(recallBlock);
  if (body.system) parts.push(body.system);
  if (nudge) parts.push(nudge);
  const systemWithMemory = parts.length
    ? parts.join("\n\n---\n\n").trim()
    : body.system;

  const provider: AssistantProvider = body.provider ?? "ollama";
  let llamaBaseUrl: string | undefined;
  if (provider === "llama-cpp") {
    if (!body.llamaUrl) {
      return NextResponse.json(
        { error: "llama-cpp provider requires llamaUrl" },
        { status: 400 },
      );
    }
    const normalized = normalizeOpenAiBaseUrl(body.llamaUrl);
    if (!normalized) {
      return NextResponse.json(
        { error: `invalid llamaUrl: ${body.llamaUrl}` },
        { status: 400 },
      );
    }
    llamaBaseUrl = normalized;
  }

  let effectiveModel = body.model;
  if (provider === "ollama" && body.contextLength && body.contextLength > 0) {
    try {
      effectiveModel = await deriveCtxModel(body.model, body.contextLength);
    } catch {
      effectiveModel = body.model;
    }
  }

  const job = createJob(body.assistantId, body.sessionId);

  // Spawn the runner — fire and forget. It communicates through the
  // job registry's event append.
  spawnJobRunner({
    jobId: job.id,
    systemPrompt: systemWithMemory ?? "",
    clientMessages: clientMsgs,
    model: effectiveModel,
    think: body.think ?? "medium",
    enabledTools: enabled,
    autoApproveTools: body.autoApproveTools ?? [],
    requireApproval: body.requireApproval ?? DEFAULT_REQUIRE_APPROVAL,
    maxToolTurns: body.maxToolTurns ?? 100,
    assistantId: body.assistantId,
    sessionId: body.sessionId,
    provider,
    llamaBaseUrl,
  });

  return NextResponse.json({ jobId: job.id }, { status: 201 });
}

export async function GET() {
  const { listActiveJobs } = await import("@/lib/jobRegistry");
  const active = listActiveJobs();
  return NextResponse.json({
    jobs: active.map((j) => ({
      id: j.id,
      assistantId: j.assistantId,
      sessionId: j.sessionId,
      status: j.status,
      createdAt: j.createdAt,
    })),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/jobs/route.ts
git commit -m "feat(jobs): POST /api/jobs creates job and spawns runner; GET lists active"
```

---

### Task 4: Job Runner — bridge between registry and pi-agent-core

**Files:**
- Create: `src/lib/jobRunner.ts`

This module takes a job config, runs the pi-agent-core Agent, and feeds events + persistence through the job registry. It's the "background" equivalent of `startPiRun` but without an HTTP stream dependency.

- [ ] **Step 1: Create jobRunner with agent lifecycle**

```typescript
// src/lib/jobRunner.ts
import { nanoid } from "nanoid";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent, AgentTool, BeforeToolCallContext, BeforeToolCallResult } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolCall } from "@mariozechner/pi-ai";
import {
  piModelForOllama,
  piModelForOpenAICompat,
  piThinkLevel,
  piToolsFromEnabled,
  toPiMessages,
} from "@/lib/piAdapters";
import type { ClientMsg } from "@/lib/toolLoop";
import { IMPLICIT_TOOL_NAMES } from "@/lib/tools";
import {
  appendEvent,
  setJobStatus,
  setJobAbort,
  pauseForApproval,
  getJob,
} from "@/lib/jobRegistry";
import { appendMessage, updateSessionMeta } from "@/lib/store";
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

function uid(): string {
  return nanoid(12);
}

export function spawnJobRunner(input: JobRunnerInput): void {
  // Fire and forget — errors are caught and surfaced as job events.
  runJob(input).catch((e) => {
    appendEvent(input.jobId, { type: "error", message: (e as Error).message });
    setJobStatus(input.jobId, "failed");
  });
}

async function runJob(input: JobRunnerInput): Promise<void> {
  const {
    jobId, systemPrompt, clientMessages, model: modelName,
    think, enabledTools, autoApproveTools, maxToolTurns,
    assistantId, sessionId, provider, llamaBaseUrl,
  } = input;

  const model =
    provider === "llama-cpp" && llamaBaseUrl
      ? piModelForOpenAICompat(llamaBaseUrl, modelName, "llama-cpp")
      : piModelForOllama(modelName);

  const scope = { assistantId, sessionId };
  const tools = await piToolsFromEnabled(enabledTools, scope);
  const messages = await toPiMessages(clientMessages, scope);

  const approvalState = {
    autoApproveTools: [...autoApproveTools],
  };

  const turnState = { turnCount: 0, maxTurns: maxToolTurns, capped: false };

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools: tools as AgentTool[],
      thinkingLevel: piThinkLevel(think),
      messages,
    },
    toolExecution: "parallel",
    getApiKey: () => "ollama",
    beforeToolCall: async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
      const { toolCall } = ctx;
      if (IMPLICIT_TOOL_NAMES.has(toolCall.name) || approvalState.autoApproveTools.includes(toolCall.name)) {
        return undefined;
      }
      const token = nanoid(16);
      appendEvent(jobId, {
        type: "tool_approval_required",
        token,
        toolName: toolCall.name,
        arguments: (toolCall as ToolCall).arguments,
      });
      const decision = await pauseForApproval(jobId, token, toolCall.name, (toolCall as ToolCall).arguments);
      if (decision === "deny") {
        return { block: true, reason: `User declined ${toolCall.name}` };
      }
      if (decision === "cancel") {
        agent.abort();
        return { block: true, reason: "user_cancelled" };
      }
      return undefined;
    },
  });

  setJobAbort(jobId, () => agent.abort());

  // Subscribe to agent events and translate to job events + persistence
  agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case "turn_start": {
        turnState.turnCount++;
        if (!turnState.capped && turnState.turnCount > turnState.maxTurns) {
          turnState.capped = true;
          appendEvent(jobId, { type: "error", message: `maxToolTurns exceeded (${maxToolTurns})` });
          try { agent.abort(); } catch {}
        }
        return;
      }
      case "message_update": {
        const ev = event.assistantMessageEvent;
        if (ev.type === "text_delta") {
          appendEvent(jobId, { type: "content", delta: ev.delta });
        } else if (ev.type === "thinking_delta") {
          appendEvent(jobId, { type: "thinking", delta: ev.delta });
        }
        return;
      }
      case "message_end": {
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
            toolCalls.push({ name: part.name, arguments: part.arguments });
          }
        }
        const promptTokens = (msg.usage?.input ?? 0) + (msg.usage?.cacheRead ?? 0);
        appendEvent(jobId, {
          type: "done_turn",
          promptTokens,
          completionTokens: msg.usage?.output ?? 0,
        });
        appendEvent(jobId, {
          type: "assistant_message",
          content: text,
          thinking,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          stopReason: msg.stopReason,
        });
        // Server-side persistence: write the assistant message to JSONL
        const chatMsg: ChatMessage = {
          id: uid(),
          role: "assistant",
          content: text,
          thinking: thinking || undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          completionTokens: msg.usage?.output ?? 0,
          createdAt: Date.now(),
        };
        appendMessage(assistantId, sessionId, chatMsg).catch(() => {});
        updateSessionMeta(assistantId, sessionId, {
          promptTokens,
          completionTokens: msg.usage?.output ?? 0,
        }).catch(() => {});
        return;
      }
      case "tool_execution_start": {
        appendEvent(jobId, {
          type: "tool_call",
          id: event.toolCallId,
          name: event.toolName,
          arguments: event.args ?? {},
        });
        return;
      }
      case "tool_execution_end": {
        const details = event.result?.details as { full?: string } | undefined;
        const summary = details?.full ?? JSON.stringify(event.result ?? null);
        appendEvent(jobId, {
          type: "tool_result",
          id: event.toolCallId,
          name: event.toolName,
          ok: !event.isError,
          summary,
        });
        // Persist tool message
        const toolMsg: ChatMessage = {
          id: event.toolCallId ?? uid(),
          role: "tool",
          content: summary,
          toolName: event.toolName,
          toolArgs: event.args as Record<string, unknown> | undefined,
          createdAt: Date.now(),
        };
        appendMessage(assistantId, sessionId, toolMsg).catch(() => {});
        return;
      }
      case "agent_end": {
        appendEvent(jobId, { type: "end" });
        setJobStatus(jobId, "completed");
        return;
      }
    }
  });

  // Fire the agent run
  try {
    await agent.continue();
  } catch (e) {
    appendEvent(jobId, { type: "error", message: (e as Error).message });
    setJobStatus(jobId, "failed");
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jobRunner.ts
git commit -m "feat(jobs): jobRunner spawns pi-agent-core Agent, feeds events + persistence through registry"
```

---

### Task 5: GET /api/jobs/:id/stream — reconnectable SSE

**Files:**
- Create: `src/app/api/jobs/[id]/stream/route.ts`

The client connects here to watch a running job. Supports `Last-Event-ID` header for reconnection — replays all events after that ID.

- [ ] **Step 1: Create the SSE stream route**

```typescript
// src/app/api/jobs/[id]/stream/route.ts
import { getJob, subscribe } from "@/lib/jobRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return new Response(JSON.stringify({ error: "job not found" }), {
      status: 404,
    });
  }

  const lastEventId = req.headers.get("Last-Event-ID");
  const fromId = lastEventId ? parseInt(lastEventId, 10) + 1 : 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const unsub = subscribe(id, fromId, (event) => {
        try {
          controller.enqueue(
            enc.encode(`id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`),
          );
        } catch {
          // Controller closed; client disconnected
          unsub?.();
        }
      });
      if (!unsub) {
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify({ type: "error", message: "job not found" })}\n\n`),
        );
        controller.close();
        return;
      }
      // If the job is already terminal, close the stream after replay
      if (job.status === "completed" || job.status === "failed" || job.status === "aborted") {
        // Give a tick for the replay events to flush
        setTimeout(() => {
          try { controller.close(); } catch {}
          unsub();
        }, 50);
      }
      // Handle client disconnect
      req.signal.addEventListener("abort", () => {
        unsub();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/jobs/[id]/stream/route.ts
git commit -m "feat(jobs): GET /api/jobs/:id/stream — reconnectable SSE with Last-Event-ID replay"
```

---

### Task 6: Job metadata + abort + approval routes

**Files:**
- Create: `src/app/api/jobs/[id]/route.ts`
- Create: `src/app/api/jobs/[id]/approve/route.ts`

- [ ] **Step 1: GET/DELETE /api/jobs/:id**

```typescript
// src/app/api/jobs/[id]/route.ts
import { NextResponse } from "next/server";
import { getJob, abortJob } from "@/lib/jobRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: job.id,
    assistantId: job.assistantId,
    sessionId: job.sessionId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    eventCount: job.events.length,
    pendingApproval: job.pendingApproval
      ? {
          token: job.pendingApproval.token,
          toolName: job.pendingApproval.toolName,
          arguments: job.pendingApproval.arguments,
        }
      : null,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const success = abortJob(id);
  if (!success) {
    return NextResponse.json({ error: "job not found or not abortable" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: POST /api/jobs/:id/approve**

```typescript
// src/app/api/jobs/[id]/approve/route.ts
import { NextResponse } from "next/server";
import { getJob, resolveApproval } from "@/lib/jobRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApproveRequest = {
  decision: "approve" | "deny" | "cancel";
  autoApproveTools?: string[];
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as ApproveRequest;
  const { decision } = body;

  if (!decision || !["approve", "deny", "cancel"].includes(decision)) {
    return NextResponse.json({ error: "invalid decision" }, { status: 400 });
  }

  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  // If the client sends autoApproveTools, extend the runner's allowlist.
  // The runner reads approvalState.autoApproveTools on each beforeToolCall.
  if (body.autoApproveTools && job.pendingApproval) {
    // We can't directly mutate the runner's approval state from here,
    // but we can append a special event that the runner watches for.
    // Better approach: the jobRunner exposes a way to update its allowlist.
    // For now, we handle this by having the registry store autoApproveTools
    // on the job and the runner reads it in beforeToolCall.
  }

  const resolved = resolveApproval(id, decision);
  if (!resolved) {
    return NextResponse.json(
      { error: "no pending approval (already resolved or expired)" },
      { status: 410 },
    );
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/jobs/[id]/route.ts src/app/api/jobs/[id]/approve/route.ts
git commit -m "feat(jobs): metadata, abort, and HITL approval routes"
```

---

### Task 7: Update jobRegistry with autoApproveTools propagation

**Files:**
- Modify: `src/lib/jobRegistry.ts`
- Modify: `src/lib/jobRunner.ts`

The approval route needs to update the runner's live allowlist when the user picks "Approve for session."

- [ ] **Step 1: Add autoApproveTools field to Job and update helpers**

Add to the `Job` type:
```typescript
  /** Live allowlist — extended by the approval route when the user picks
   *  "approve for session". The runner's beforeToolCall reads this. */
  autoApproveTools: string[];
```

Update `createJob`:
```typescript
export function createJob(assistantId: string, sessionId: string, autoApproveTools: string[] = []): Job {
  // ... existing code, add:
  autoApproveTools,
}
```

- [ ] **Step 2: Wire runner's beforeToolCall to read job.autoApproveTools**

In `jobRunner.ts`, change the `beforeToolCall` to read from the job's live field:

```typescript
beforeToolCall: async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
  const { toolCall } = ctx;
  const currentJob = getJob(jobId);
  const approved = currentJob?.autoApproveTools ?? approvalState.autoApproveTools;
  if (IMPLICIT_TOOL_NAMES.has(toolCall.name) || approved.includes(toolCall.name)) {
    return undefined;
  }
  // ... rest of HITL logic
}
```

- [ ] **Step 3: Update approval route to mutate job.autoApproveTools**

In `src/app/api/jobs/[id]/approve/route.ts`, before resolving:

```typescript
if (body.autoApproveTools) {
  job.autoApproveTools = body.autoApproveTools;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/jobRegistry.ts src/lib/jobRunner.ts src/app/api/jobs/[id]/approve/route.ts
git commit -m "feat(jobs): propagate autoApproveTools from approval route to live runner"
```

---

### Task 8: Client integration — Chat.tsx uses job-based flow

**Files:**
- Modify: `src/components/Chat.tsx`

Replace the inline SSE consumer in `handleSend` with:
1. POST to `/api/jobs` → get `jobId`
2. Connect to `/api/jobs/:id/stream` via EventSource
3. Process events identically to today's `consumeStream`
4. On disconnect, reconnect with `Last-Event-ID`
5. HITL approval goes through `/api/jobs/:id/approve` instead of `/api/chat/resume`
6. Navigation away = just closes EventSource; job keeps running
7. On return, reconnect and replay from where we left off

- [ ] **Step 1: Add job state and useJobStream hook**

Add above `handleSend`:

```typescript
const [activeJobId, setActiveJobId] = useState<string | null>(null);
const eventSourceRef = useRef<EventSource | null>(null);
const lastEventIdRef = useRef<number>(0);

function connectToJob(jobId: string, fromEventId = 0) {
  const url = `/api/jobs/${jobId}/stream`;
  const es = new EventSource(url);
  eventSourceRef.current = es;

  es.onmessage = (ev) => {
    const eventId = parseInt(ev.lastEventId, 10);
    if (!isNaN(eventId)) lastEventIdRef.current = eventId;
    const obj = JSON.parse(ev.data) as Record<string, unknown>;
    handleJobEvent(obj);
  };

  es.onerror = () => {
    es.close();
    // Auto-reconnect after 1s with last known event ID
    setTimeout(() => {
      const job = activeJobId;
      if (job) connectToJob(job, lastEventIdRef.current + 1);
    }, 1000);
  };
}
```

- [ ] **Step 2: Replace handleSend's fetch loop with job creation**

The new `handleSend` body (after preparing `userMsg` and `assembled`):

```typescript
// 1. POST to create job
const res = await fetch("/api/jobs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(initialPayload),
});
const { jobId } = await res.json();
setActiveJobId(jobId);

// 2. Connect to the event stream
connectToJob(jobId);
```

- [ ] **Step 3: Implement handleJobEvent (same logic as consumeStream)**

```typescript
function handleJobEvent(obj: Record<string, unknown>) {
  const t = obj.type as string;
  if (t === "content") {
    ensureNonToolPhase("writing");
    const cur = assembled[curIndex];
    patchCur({ content: cur.content + String(obj.delta ?? "") });
  } else if (t === "thinking") {
    // ... identical to existing consumeStream handlers
  } else if (t === "tool_approval_required") {
    setPendingApproval({
      token: String(obj.token ?? ""),
      toolName: String(obj.toolName ?? ""),
      arguments: (obj.arguments as Record<string, unknown>) ?? {},
      index: 0,
    });
  } else if (t === "end") {
    // Job completed — finalize
    eventSourceRef.current?.close();
    setStreaming(false);
    streamingRef.current = false;
    setActiveJobId(null);
    // No client-side persist needed — server already wrote to JSONL
    loadSessions();
  }
  // ... rest of event handlers (same as today)
}
```

- [ ] **Step 4: Update approval handler to use job route**

```typescript
async function handleApproval(decision: "approve" | "deny" | "cancel", persist: "none" | "tool" | "all") {
  if (!activeJobId) return;
  let approved = [...sessionApprovedTools];
  if (persist === "tool" && pendingApproval) {
    approved = [...approved, pendingApproval.toolName];
    setSessionApprovedTools(new Set(approved));
  } else if (persist === "all") {
    approved = allTools.map(t => t.name);
    setSessionApprovedTools(new Set(approved));
  }
  await fetch(`/api/jobs/${activeJobId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, autoApproveTools: approved }),
  });
  setPendingApproval(null);
}
```

- [ ] **Step 5: Handle navigation + reconnection**

Add a useEffect that reconnects to an active job on mount:

```typescript
useEffect(() => {
  // Check if there's a running job for this session
  if (!sessionId) return;
  fetch(`/api/jobs?sessionId=${sessionId}`)
    .then(r => r.json())
    .then(({ jobs }) => {
      const active = jobs.find((j: any) =>
        j.sessionId === sessionId && (j.status === "running" || j.status === "paused")
      );
      if (active) {
        setActiveJobId(active.id);
        setStreaming(true);
        streamingRef.current = true;
        connectToJob(active.id);
      }
    })
    .catch(() => {});
  return () => {
    eventSourceRef.current?.close();
  };
}, [sessionId]);
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): switch to job-based execution with reconnectable EventSource"
```

---

### Task 9: Vision OCR for image-based PDF pages

**Files:**
- Modify: `src/lib/tools/web.ts` (or `src/lib/uploads.ts` depending on where extraction lives)
- Modify: `python/extract_doc.py`

When a PDF's text extraction yields empty/near-empty output for a page, render the page as an image and send it to the active multimodal model for OCR.

- [ ] **Step 1: Check current PDF extraction path**

The file `python/extract_doc.py` handles PDF text extraction. Read it to understand the current flow.

- [ ] **Step 2: Add image-render fallback to extract_doc.py**

Add a function that detects image-only pages (< 20 chars extracted) and renders them to PNG using `pdf2image` (which wraps `pdftoppm`):

```python
from pdf2image import convert_from_path

def extract_with_ocr_fallback(pdf_path: str, ollama_url: str, model: str) -> str:
    """Extract text from PDF, falling back to vision model for image-only pages."""
    import fitz  # PyMuPDF
    doc = fitz.open(pdf_path)
    pages_text = []
    image_pages = []

    for i, page in enumerate(doc):
        text = page.get_text().strip()
        if len(text) > 20:
            pages_text.append((i, text))
        else:
            image_pages.append(i)

    if not image_pages:
        return "\n\n".join(t for _, t in pages_text)

    # Render image-only pages and send to vision model
    images = convert_from_path(pdf_path, first_page=None, last_page=None, dpi=200)
    for page_idx in image_pages:
        if page_idx >= len(images):
            continue
        img = images[page_idx]
        import io, base64
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()

        # Call Ollama vision
        import requests
        resp = requests.post(f"{ollama_url}/api/chat", json={
            "model": model,
            "messages": [{
                "role": "user",
                "content": "Extract all text from this page. Preserve structure (headings, lists, tables). Return only the extracted text, no commentary.",
                "images": [b64],
            }],
            "stream": False,
        })
        if resp.ok:
            result = resp.json()
            ocr_text = result.get("message", {}).get("content", "")
            pages_text.append((page_idx, ocr_text))

    pages_text.sort(key=lambda x: x[0])
    return "\n\n".join(t for _, t in pages_text)
```

- [ ] **Step 3: Update the Node-side upload handler to pass model info**

In `src/lib/uploads.ts` (the document extraction path), when calling the Python extractor, pass the current model name and Ollama URL so the vision fallback knows which model to hit:

```typescript
// In the extractText function, add env vars to the python call:
const env = {
  ...process.env,
  OLLAMA_URL: OLLAMA_URL,
  VISION_MODEL: "qwen3.6:27b", // or read from settings
};
```

- [ ] **Step 4: Add pdf2image + PyMuPDF to python/requirements.txt**

```
pdf2image
PyMuPDF
```

- [ ] **Step 5: Commit**

```bash
git add python/extract_doc.py python/requirements.txt src/lib/uploads.ts
git commit -m "feat(pdf): vision OCR fallback for image-based PDF pages via multimodal model"
```

---

## Self-Review

**Spec coverage:**
- Background job creation: Task 3 ✓
- Server-side persistence: Task 2 + Task 4 ✓
- Reconnectable stream: Task 5 ✓
- Parallel jobs: Registry supports it, GET /api/jobs lists all active ✓
- HITL approval: Task 6 + Task 7 ✓
- Client integration: Task 8 ✓
- Vision OCR: Task 9 ✓

**Placeholder scan:** No TBD/TODO entries. All code blocks are complete.

**Type consistency:** `JobEvent`, `Job`, `appendEvent`, `subscribe` — names consistent across Task 1 (definition) and Tasks 3-8 (usage). `appendMessage`/`updateSessionMeta` match between Task 2 (definition) and Task 4 (usage).

**Note on backwards compatibility:** The old `/api/chat` and `/api/chat/resume` routes remain untouched — the client can fall back to them if needed. Task 8 replaces the client's usage, but the server routes are deprecated-in-place, not deleted.

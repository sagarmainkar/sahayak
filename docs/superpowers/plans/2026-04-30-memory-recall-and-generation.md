# Memory Recall and Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sahayak's memory subsystem feel like it "just works" — auto-recall before every user turn, an opaque save-check nudge every 4 turns, server-side dedup on writes, and visible index health — without breaking existing memory entries.

**Architecture:** Three concentric changes around the existing JSONL store. (1) Library-level: new `getRecallContext` and `retryPendingVectors` exports in `src/lib/memory.ts`, sidecar gains `lastRecalledAt`, write path adds dedup + `vectorPending` retry. (2) Chat-route integration: per-turn auto-recall block + opaque nudge every 4 user turns + best-effort pending-vector retry. (3) UX edges: tightened `remember` tool description, updated archetype prompts, type-filter chips and `lastRecalledAt` on `MemoryPage`, Memory health row on `SettingsPage`, opt-in migration script for legacy types.

**Tech Stack:** Next.js 16 App Router (Node.js runtime), TypeScript, React 19, Tailwind 4. Local Ollama for embeddings via `nomic-embed-text`. JSONL file store, no DB. No test suite — verification is via `curl` against the dev server (port 9999) and browser inspection.

---

## File Structure

| File | Role |
| --- | --- |
| `src/lib/types.ts` | `MemoryEntry` gains `vectorPending?: boolean`. Add `ACTIVE_MEMORY_TYPES = ["fact","preference","procedural"] as const` for new entries; existing `MEMORY_TYPES` kept as the read-tolerance superset of all 6 so legacy log entries don't break. |
| `src/lib/memory.ts` | Existing CRUD module. Gains: dedup inside `createMemory` (cosine > 0.92 → already_known), `getRecallContext`, sidecar `lastRecalledAt` + `bumpRecalledAt`, `vectorPending` flow on embed failure, `retryPendingVectors` helper, `lastRebuildAt` persisted in `<configdir>/memory.meta.json`, `getMemoryHealth` aggregator. |
| `src/lib/tools/memory.ts` | Tighten `remember` tool description; restrict its `type` enum to `ACTIVE_MEMORY_TYPES`; surface `pleaseReview: true` in the tool result when total > 200. |
| `src/app/api/chat/route.ts` | Inject auto-recall block per user turn; append save-check nudge on every 4th user turn; fire-and-forget `retryPendingVectors` (capped) per request. |
| `src/app/api/memory/health/route.ts` | New `GET` endpoint returning `{ total, indexed, pending, lastRebuildAt }`. |
| `src/lib/archetypes.ts` | Rewrite the "Memory" sections of `GENERAL_SYSTEM_PROMPT` and `SOFTWARE_ENGINEER_SYSTEM_PROMPT` to reflect auto-recall + 3-type taxonomy. |
| `src/components/MemoryPage.tsx` | Type filter chips for `ACTIVE_MEMORY_TYPES`; show `lastRecalledAt` per card; constrain the add-memory `<select>` to active types. Legacy-typed entries still render under their original type so users can see and migrate them. |
| `src/components/SettingsPage.tsx` | New Memory-health section: total / indexed / pending / last-rebuild + Rebuild button. |
| `scripts/migrate-memory-types.ts` | Opt-in CLI: reads `memory.jsonl`, classifies legacy entries (`episodic`/`event` → delete; `semantic` → `procedural` if has command-shaped content, else delete), writes plan to stdout, applies on `--apply`. Backs up the original log. |

---

## Conventions for this plan

- The project has **no test suite** by design. CLAUDE.md states: *"There is no test suite. Verify UI changes by running `npm run dev` and exercising the feature in a browser."* So the TDD pattern adapts: each task ends with a **manual verification step** (curl against the dev server, browser smoke, or `npx tsc --noEmit` for type-only changes) before the commit.
- Dev server: `npm run dev` on `http://localhost:9999`. Assume it's running in a separate terminal during verification. If not, the task starts it.
- Memory paths: `MEMORY_FILE = .config/memory.jsonl`, `MEMORY_VEC_FILE = .config/memory.vec.jsonl`, plus a new `.config/memory.meta.json` for `lastRebuildAt`.
- For each task that edits a file: the step shows the **complete replacement block** for the region being changed, anchored on a unique pre-existing line. No "add code somewhere here" placeholders.
- Commits are per-task, with concise subject lines and the project's `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer (per CLAUDE.md commit conventions).

---

### Task 1: Type changes — add `vectorPending` and `ACTIVE_MEMORY_TYPES`

**Files:**
- Modify: `src/lib/types.ts:138-156`

- [ ] **Step 1: Edit types.ts to add `ACTIVE_MEMORY_TYPES` and `vectorPending`**

Replace the block from `export const MEMORY_TYPES = [` through the end of `MemoryEntry` with this. Note: `MEMORY_TYPES` deliberately stays at all 6 values so legacy JSONL entries continue to deserialize — `ACTIVE_MEMORY_TYPES` is what the model and UI surface for new writes.

```typescript
export const MEMORY_TYPES = [
  "fact",
  "preference",
  "episodic",
  "procedural",
  "event",
  "semantic",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Types Sahayak surfaces for new entries. The full `MEMORY_TYPES` list
 *  is retained for read-tolerance of legacy log entries; the model and
 *  the MemoryPage "add" form should only offer active types. */
export const ACTIVE_MEMORY_TYPES = [
  "fact",
  "preference",
  "procedural",
] as const;
export type ActiveMemoryType = (typeof ACTIVE_MEMORY_TYPES)[number];

export type MemoryEntry = {
  id: string;
  type: MemoryType;
  content: string;
  source: "user" | "model";
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
  /** Set true when the entry was created/updated but embedding failed
   *  (Ollama down, model missing, etc.). The chat route runs a periodic
   *  retry that clears this flag and appends to the vector sidecar. */
  vectorPending?: boolean;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd /srv/work/sahayak && npx tsc --noEmit`
Expected: no errors. (`ACTIVE_MEMORY_TYPES` is unused so far — that's fine.)

- [ ] **Step 3: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/types.ts
git commit -m "$(cat <<'EOF'
memory types: ACTIVE_MEMORY_TYPES and vectorPending

Add a 3-type subset (fact/preference/procedural) for new
writes; keep MEMORY_TYPES at all 6 for read-tolerance of
legacy log entries. Add optional vectorPending flag for
later embed-retry plumbing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Server-side dedup in `createMemory`

**Files:**
- Modify: `src/lib/memory.ts:155-175`

- [ ] **Step 1: Replace `createMemory` with the dedup-aware version**

Find the existing `export async function createMemory(input: {` block (around line 155) and replace the whole function with the version below. The signature gains a return type: instead of always returning `MemoryEntry`, it returns `{ status: "created" | "already_known"; entry: MemoryEntry }` so callers can branch.

```typescript
export type CreateResult =
  | { status: "created"; entry: MemoryEntry }
  | { status: "already_known"; entry: MemoryEntry };

const DEDUP_THRESHOLD = 0.92;

export async function createMemory(input: {
  type: MemoryType;
  content: string;
  source?: "user" | "model";
  sessionId?: string;
}): Promise<CreateResult> {
  const now = Date.now();
  const content = input.content.trim();

  // Dedup: embed first, compare to existing vectors, return existing if too close.
  const candidateVec = await embedText(content);
  if (candidateVec) {
    const memories = await listMemories();
    const vectors = await readVectors();
    let bestId: string | null = null;
    let bestScore = 0;
    for (const m of memories) {
      const v = vectors.get(m.id);
      if (!v) continue;
      const s = cosine(candidateVec, v);
      if (s > bestScore) {
        bestScore = s;
        bestId = m.id;
      }
    }
    if (bestId && bestScore >= DEDUP_THRESHOLD) {
      const existing = memories.find((m) => m.id === bestId);
      if (existing) return { status: "already_known", entry: existing };
    }
  }

  const entry: MemoryEntry = {
    id: nanoid(10),
    type: input.type,
    content,
    source: input.source ?? "user",
    sessionId: input.sessionId,
    createdAt: now,
    updatedAt: now,
  };
  await appendLog({ op: "create", entry });
  if (candidateVec) {
    await appendVector({ id: entry.id, vector: candidateVec });
  } else {
    // Embedding failed — mark pending so the retry loop picks it up later.
    entry.vectorPending = true;
    await appendLog({
      op: "update",
      id: entry.id,
      content: entry.content,
      type: entry.type,
      updatedAt: now,
    });
  }
  return { status: "created", entry };
}
```

> Note: the `vectorPending` write-back here uses a degenerate update record. We'll switch to a proper update record shape in Task 3, where we also extend the log type. For now this lands the dedup logic without breaking callers — they'll be updated in subsequent tasks.

- [ ] **Step 2: Update `src/lib/tools/memory.ts` `remember` handler to accept the new return shape**

Replace the body of the `handler` in the `remember` tool spec (currently at `src/lib/tools/memory.ts:39-46`) with the version below. Surfaces the dedup status to the model so it knows not to retry.

```typescript
  async handler(args) {
    const type = coerceType(args.type);
    if (!type) return err("bad_type", `type must be one of ${TYPE_ENUM.join(",")}`);
    const content = String(args.content ?? "").trim();
    if (!content) return err("empty_content", "content is required");
    const result = await createMemory({ type, content, source: "model" });
    return ok({
      id: result.entry.id,
      type: result.entry.type,
      content: result.entry.content,
      status: result.status,
    });
  },
```

- [ ] **Step 3: Update `src/app/api/memory/route.ts` POST handler for the same return shape**

Replace the trailing `return NextResponse.json({ memory: entry });` block. Find:

```typescript
  const entry = await createMemory({
    type,
    content,
    source,
    sessionId: typeof body?.sessionId === "string" ? body.sessionId : undefined,
  });
  return NextResponse.json({ memory: entry });
```

Replace with:

```typescript
  const result = await createMemory({
    type,
    content,
    source,
    sessionId: typeof body?.sessionId === "string" ? body.sessionId : undefined,
  });
  return NextResponse.json({ memory: result.entry, status: result.status });
```

- [ ] **Step 4: Verify dedup with curl against the dev server**

Run (assumes dev server is up on 9999; if not, `npm run dev` first):

```bash
curl -s -X POST http://localhost:9999/api/memory \
  -H 'Content-Type: application/json' \
  -d '{"type":"fact","content":"Plan-test memory: alpha bravo charlie"}' | jq
curl -s -X POST http://localhost:9999/api/memory \
  -H 'Content-Type: application/json' \
  -d '{"type":"fact","content":"Plan-test memory: alpha bravo charlie"}' | jq
```

Expected: first call `"status":"created"`. Second call `"status":"already_known"` with the **same id** as the first.

- [ ] **Step 5: Clean up the test entries**

```bash
# grab the id from the previous curl output, replace <id>
curl -s -X DELETE http://localhost:9999/api/memory/<id>
```

- [ ] **Step 6: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/memory.ts src/lib/tools/memory.ts src/app/api/memory/route.ts
git commit -m "$(cat <<'EOF'
memory: server-side dedup on remember (cosine > 0.92)

createMemory now embeds the candidate, compares to existing
vectors, and returns {status:"already_known", entry: existing}
when a near-duplicate is found instead of appending a new
row. The remember tool surfaces the status so the model
doesn't loop on a successful save.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Proper `vectorPending` log shape + retry helper

**Files:**
- Modify: `src/lib/memory.ts` (LogRec types around line 19; `createMemory` around line 155; `updateMemory` around line 177)

- [ ] **Step 1: Extend the `UpdateRec` shape to carry `vectorPending`**

At `src/lib/memory.ts:21-27`, replace the `UpdateRec` type with:

```typescript
type UpdateRec = {
  op: "update";
  id: string;
  content: string;
  type?: MemoryType;
  updatedAt: number;
  vectorPending?: boolean;
};
```

- [ ] **Step 2: Make the log replay honor `vectorPending`**

At `src/lib/memory.ts:64-72`, replace the `op === "update"` branch in `listMemories` with:

```typescript
    } else if (rec.op === "update") {
      const cur = byId.get(rec.id);
      if (!cur) continue;
      byId.set(rec.id, {
        ...cur,
        content: rec.content,
        type: rec.type ?? cur.type,
        updatedAt: rec.updatedAt,
        ...(rec.vectorPending !== undefined
          ? { vectorPending: rec.vectorPending }
          : {}),
      });
    } else if (rec.op === "delete") {
```

Also extend the `op === "create"` branch a few lines above to honor `vectorPending` if present on the entry — replace:

```typescript
    if (rec.op === "create") {
      byId.set(rec.entry.id, rec.entry);
    } else if (rec.op === "update") {
```

with:

```typescript
    if (rec.op === "create") {
      byId.set(rec.entry.id, { ...rec.entry });
    } else if (rec.op === "update") {
```

(spread so subsequent updates don't accidentally mutate the same object.)

- [ ] **Step 3: Replace the bottom of `createMemory` to emit a real `vectorPending` update on embed failure**

In Task 2 we used a degenerate update record. Replace the trailing block of `createMemory` (the `if (candidateVec) { ... } else { ... }` portion) with:

```typescript
  await appendLog({ op: "create", entry });
  if (candidateVec) {
    await appendVector({ id: entry.id, vector: candidateVec });
  } else {
    entry.vectorPending = true;
    await appendLog({
      op: "update",
      id: entry.id,
      content: entry.content,
      type: entry.type,
      updatedAt: now,
      vectorPending: true,
    });
  }
  return { status: "created", entry };
```

- [ ] **Step 4: Update `updateMemory` to handle embed failure the same way**

Find `updateMemory` at `src/lib/memory.ts:177-197` and replace the function body with:

```typescript
export async function updateMemory(
  id: string,
  patch: { content?: string; type?: MemoryType },
): Promise<MemoryEntry | null> {
  const cur = await getMemory(id);
  if (!cur) return null;
  const content = patch.content?.trim() ?? cur.content;
  const type = patch.type ?? cur.type;
  const updatedAt = Date.now();

  let vectorPending: boolean | undefined;
  if (content !== cur.content) {
    const vec = await embedText(content);
    if (vec) {
      const map = await readVectors();
      map.set(id, vec);
      await writeVectors(map);
      vectorPending = false;
    } else {
      vectorPending = true;
    }
  }

  await appendLog({
    op: "update",
    id,
    content,
    type,
    updatedAt,
    ...(vectorPending !== undefined ? { vectorPending } : {}),
  });
  return {
    ...cur,
    content,
    type,
    updatedAt,
    ...(vectorPending !== undefined ? { vectorPending } : {}),
  };
}
```

- [ ] **Step 5: Add `retryPendingVectors` helper**

Append to `src/lib/memory.ts` (after `rebuildVectors`):

```typescript
/** Best-effort retry: pick up to `cap` entries with `vectorPending: true`,
 *  embed each, append to the sidecar, and emit an `update` log record
 *  clearing the flag. Called by the chat route per request. Failures stay
 *  pending and are picked up next time. */
export async function retryPendingVectors(
  cap = 5,
): Promise<{ retried: number; cleared: number }> {
  const memories = await listMemories();
  const pending = memories.filter((m) => m.vectorPending).slice(0, cap);
  let cleared = 0;
  for (const m of pending) {
    const vec = await embedText(m.content);
    if (!vec) continue;
    await appendVector({ id: m.id, vector: vec });
    await appendLog({
      op: "update",
      id: m.id,
      content: m.content,
      type: m.type,
      updatedAt: Date.now(),
      vectorPending: false,
    });
    cleared++;
  }
  return { retried: pending.length, cleared };
}
```

- [ ] **Step 6: Verify the retry loop**

Stop Ollama briefly (or rename `nomic-embed-text` in your local cache), then:

```bash
curl -s -X POST http://localhost:9999/api/memory \
  -H 'Content-Type: application/json' \
  -d '{"type":"fact","content":"Plan-test pending: delta echo foxtrot"}' | jq
```

Expect the entry to come back with `vectorPending: true`. Restart Ollama. Then exercise the retry by calling it from a one-off node script (the chat-route invocation will do this naturally once Task 8 lands; for now we test the helper directly):

```bash
cd /srv/work/sahayak
node -e "(async()=>{const m=await import('./src/lib/memory.ts');console.log(await m.retryPendingVectors(5));})()" 2>/dev/null \
  || npx tsx -e "import {retryPendingVectors} from './src/lib/memory.ts'; retryPendingVectors(5).then(console.log)"
```

(If neither works because of TS-loader nuance, defer this verification to Task 8 where the chat route exercises it via a real request.)

Then list memories — the test entry should no longer have `vectorPending`:

```bash
curl -s http://localhost:9999/api/memory | jq '.memories[] | select(.content | startswith("Plan-test pending"))'
```

Clean up:

```bash
curl -s -X DELETE http://localhost:9999/api/memory/<id>
```

- [ ] **Step 7: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/memory.ts
git commit -m "$(cat <<'EOF'
memory: vectorPending flag + retry helper

Embed failures (Ollama down, embed model missing) now persist
the entry with vectorPending:true instead of silently leaving
it unindexed. retryPendingVectors() reprocesses up to N pending
entries; the chat route will call this best-effort each request.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Sidecar gains `lastRecalledAt` + `bumpRecalledAt` helper

**Files:**
- Modify: `src/lib/memory.ts` (VecRec type around line 31; sidecar IO around lines 87-116)

- [ ] **Step 1: Extend `VecRec`**

At `src/lib/memory.ts:31`, replace:

```typescript
type VecRec = { id: string; vector: number[] };
```

with:

```typescript
type VecRec = { id: string; vector: number[]; lastRecalledAt?: number };
```

- [ ] **Step 2: Update sidecar IO to round-trip `lastRecalledAt`**

Replace `readVectors` (currently at lines 87-101) with a richer reader plus a small wrapper that returns just the vector map for back-compat with existing callers:

```typescript
type SidecarMap = Map<string, { vector: number[]; lastRecalledAt?: number }>;

async function readSidecar(): Promise<SidecarMap> {
  if (!existsSync(VEC_FILE)) return new Map();
  const raw = await fs.readFile(VEC_FILE, "utf8");
  const out: SidecarMap = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as VecRec;
      out.set(r.id, {
        vector: r.vector,
        lastRecalledAt: r.lastRecalledAt,
      });
    } catch {
      continue;
    }
  }
  return out;
}

async function readVectors(): Promise<Map<string, number[]>> {
  const sidecar = await readSidecar();
  const out = new Map<string, number[]>();
  for (const [id, v] of sidecar) out.set(id, v.vector);
  return out;
}
```

- [ ] **Step 3: Update `writeVectors` to preserve `lastRecalledAt` if available**

Replace `writeVectors` (currently at lines 109-116) with a version that accepts an optional metadata map:

```typescript
async function writeVectors(
  map: Map<string, number[]>,
  meta?: Map<string, { lastRecalledAt?: number }>,
) {
  await ensureDirs();
  const lines: string[] = [];
  for (const [id, vector] of map) {
    const m = meta?.get(id);
    const rec: VecRec = { id, vector };
    if (m?.lastRecalledAt !== undefined) rec.lastRecalledAt = m.lastRecalledAt;
    lines.push(JSON.stringify(rec));
  }
  await fs.writeFile(VEC_FILE, lines.length ? lines.join("\n") + "\n" : "");
}
```

- [ ] **Step 4: Make `updateMemory`'s sidecar rewrite preserve recall timestamps**

In `updateMemory`, replace the inner block:

```typescript
      const map = await readVectors();
      map.set(id, vec);
      await writeVectors(map);
```

with:

```typescript
      const sidecar = await readSidecar();
      const prev = sidecar.get(id);
      const vectors = new Map<string, number[]>();
      const meta = new Map<string, { lastRecalledAt?: number }>();
      for (const [sid, sv] of sidecar) {
        vectors.set(sid, sv.vector);
        if (sv.lastRecalledAt !== undefined)
          meta.set(sid, { lastRecalledAt: sv.lastRecalledAt });
      }
      vectors.set(id, vec);
      meta.set(id, { lastRecalledAt: prev?.lastRecalledAt });
      await writeVectors(vectors, meta);
```

- [ ] **Step 5: Add `bumpRecalledAt` (debounced)**

Append to `src/lib/memory.ts`:

```typescript
const BUMP_DEBOUNCE_MS = 60_000;

/** Update `lastRecalledAt` for a set of memory ids in the vector sidecar.
 *  Debounced: ids whose existing timestamp is younger than 60s are skipped
 *  to avoid hot-loops on repeated short queries. */
export async function bumpRecalledAt(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const sidecar = await readSidecar();
  const now = Date.now();
  let changed = false;
  for (const id of ids) {
    const cur = sidecar.get(id);
    if (!cur) continue;
    if (cur.lastRecalledAt && now - cur.lastRecalledAt < BUMP_DEBOUNCE_MS) {
      continue;
    }
    cur.lastRecalledAt = now;
    sidecar.set(id, cur);
    changed = true;
  }
  if (!changed) return;
  const vectors = new Map<string, number[]>();
  const meta = new Map<string, { lastRecalledAt?: number }>();
  for (const [id, v] of sidecar) {
    vectors.set(id, v.vector);
    if (v.lastRecalledAt !== undefined) {
      meta.set(id, { lastRecalledAt: v.lastRecalledAt });
    }
  }
  await writeVectors(vectors, meta);
}

/** Expose `lastRecalledAt` for the UI without dragging the sidecar map
 *  through API serialization. Returns a plain id → ts mapping. */
export async function getRecalledAtMap(): Promise<Record<string, number>> {
  const sidecar = await readSidecar();
  const out: Record<string, number> = {};
  for (const [id, v] of sidecar) {
    if (v.lastRecalledAt !== undefined) out[id] = v.lastRecalledAt;
  }
  return out;
}
```

- [ ] **Step 6: Typecheck**

Run: `cd /srv/work/sahayak && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/memory.ts
git commit -m "$(cat <<'EOF'
memory sidecar: lastRecalledAt + bumpRecalledAt

Vector sidecar records gain an optional lastRecalledAt
timestamp; bumpRecalledAt updates it (debounced 60s) for a
set of ids. The main JSONL log stays clean — recall stats
live entirely in the always-rewritten sidecar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `getRecallContext` function

**Files:**
- Modify: `src/lib/memory.ts` (append after `searchMemory` around line 240)

- [ ] **Step 1: Add `getRecallContext`**

Append to `src/lib/memory.ts`:

```typescript
const RECALL_DEFAULT_K = 3;
const RECALL_DEFAULT_THRESHOLD = 0.7;
const PINNED_TYPES: ReadonlySet<MemoryType> = new Set(["fact", "preference"]);

/** Score `userMessage` against the memory pool and return a formatted
 *  block ready to prepend to the system prompt. Empty string when no
 *  memory clears the threshold or embedding fails. */
export async function getRecallContext(
  userMessage: string,
  opts?: {
    k?: number;
    threshold?: number;
    /** When true (default), skip fact + preference — they're already in
     *  the always-injected block, no point doubling tokens. */
    excludePinnedTypes?: boolean;
  },
): Promise<string> {
  const q = userMessage.trim();
  if (!q) return "";
  const qVec = await embedText(q);
  if (!qVec) return "";

  const k = opts?.k ?? RECALL_DEFAULT_K;
  const threshold = opts?.threshold ?? RECALL_DEFAULT_THRESHOLD;
  const excludePinned = opts?.excludePinnedTypes ?? true;

  const memories = await listMemories();
  const vectors = await readVectors();
  const hits: { entry: MemoryEntry; score: number }[] = [];
  for (const m of memories) {
    if (excludePinned && PINNED_TYPES.has(m.type)) continue;
    const v = vectors.get(m.id);
    if (!v) continue;
    const score = cosine(qVec, v);
    if (score < threshold) continue;
    hits.push({ entry: m, score });
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, k);
  if (top.length === 0) return "";

  // Fire-and-forget: bump recall timestamps for the surfaced ids.
  void bumpRecalledAt(top.map((h) => h.entry.id));

  const lines: string[] = ["Possibly relevant from memory:"];
  for (const h of top) {
    lines.push(`- [${h.entry.type}] ${h.entry.content}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /srv/work/sahayak && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Quick smoke via curl (no chat route wiring yet)**

Add a temporary throwaway route at `/api/memory/recall-test/route.ts` to exercise the function — or skip and rely on Task 8's verification. (Recommended: skip; we'll see it work end-to-end after wiring.)

- [ ] **Step 4: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/memory.ts
git commit -m "$(cat <<'EOF'
memory: getRecallContext for always-on auto-recall

Embeds the user message, scores against the vector sidecar,
excludes pinned types (fact/preference are already always-
injected), takes top-k>=threshold, and returns a formatted
"Possibly relevant from memory:" block. Bumps recall
timestamps fire-and-forget.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Memory health metadata + `getMemoryHealth`

**Files:**
- Modify: `src/lib/paths.ts` (add `MEMORY_META_FILE`)
- Modify: `src/lib/memory.ts` (track `lastRebuildAt`; add `getMemoryHealth`)

- [ ] **Step 1: Add `MEMORY_META_FILE` to paths.ts**

At `src/lib/paths.ts:37`, just after the `MEMORY_VEC_FILE` line, add:

```typescript
export const MEMORY_META_FILE = path.join(CONFIG_DIR, "memory.meta.json");
```

- [ ] **Step 2: Persist `lastRebuildAt` from `rebuildVectors`**

In `src/lib/memory.ts`, add to the imports at the top:

```typescript
import {
  CONFIG_DIR,
  MEMORY_FILE,
  MEMORY_META_FILE,
  MEMORY_VEC_FILE as VEC_FILE,
} from "@/lib/paths";
```

Then replace `rebuildVectors` (currently at lines 243-257) with:

```typescript
export async function rebuildVectors(): Promise<{
  indexed: number;
  skipped: number;
  lastRebuildAt: number;
}> {
  const memories = await listMemories();
  const map = new Map<string, number[]>();
  let skipped = 0;
  for (const m of memories) {
    const v = await embedText(m.content);
    if (v) map.set(m.id, v);
    else skipped++;
  }
  await writeVectors(map);
  const lastRebuildAt = Date.now();
  await ensureDirs();
  await fs.writeFile(
    MEMORY_META_FILE,
    JSON.stringify({ lastRebuildAt }, null, 2),
  );
  return { indexed: map.size, skipped, lastRebuildAt };
}
```

- [ ] **Step 3: Add `getMemoryHealth`**

Append to `src/lib/memory.ts`:

```typescript
export async function getMemoryHealth(): Promise<{
  total: number;
  indexed: number;
  pending: number;
  lastRebuildAt: number | null;
}> {
  const memories = await listMemories();
  const vectors = await readVectors();
  const indexed = memories.reduce(
    (n, m) => n + (vectors.has(m.id) ? 1 : 0),
    0,
  );
  const pending = memories.reduce(
    (n, m) => n + (m.vectorPending ? 1 : 0),
    0,
  );
  let lastRebuildAt: number | null = null;
  if (existsSync(MEMORY_META_FILE)) {
    try {
      const raw = await fs.readFile(MEMORY_META_FILE, "utf8");
      const parsed = JSON.parse(raw) as { lastRebuildAt?: number };
      if (typeof parsed.lastRebuildAt === "number")
        lastRebuildAt = parsed.lastRebuildAt;
    } catch {
      // fall through with null
    }
  }
  return {
    total: memories.length,
    indexed,
    pending,
    lastRebuildAt,
  };
}
```

- [ ] **Step 4: Add the health endpoint**

Create `src/app/api/memory/health/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getMemoryHealth } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getMemoryHealth());
}
```

- [ ] **Step 5: Verify**

```bash
curl -s http://localhost:9999/api/memory/health | jq
```

Expected output shape:

```json
{ "total": <n>, "indexed": <m>, "pending": 0, "lastRebuildAt": null }
```

(`lastRebuildAt` will be null until someone hits Rebuild; that's fine.)

- [ ] **Step 6: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/paths.ts src/lib/memory.ts src/app/api/memory/health/route.ts
git commit -m "$(cat <<'EOF'
memory: health endpoint + lastRebuildAt persistence

rebuildVectors now writes .config/memory.meta.json with the
rebuild timestamp; getMemoryHealth returns total/indexed/
pending/lastRebuildAt; new GET /api/memory/health surfaces
it for the settings page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire auto-recall + nudge + retry into chat route

**Files:**
- Modify: `src/app/api/chat/route.ts` (lines 10, 70-78)

- [ ] **Step 1: Update the import line**

At `src/app/api/chat/route.ts:10`, replace:

```typescript
import { buildAlwaysInjectedBlock } from "@/lib/memory";
```

with:

```typescript
import {
  buildAlwaysInjectedBlock,
  getRecallContext,
  retryPendingVectors,
} from "@/lib/memory";
```

- [ ] **Step 2: Replace the system-prompt composition block**

At `src/app/api/chat/route.ts:70-78`, replace the comment + memBlock + `systemWithMemory` lines with the version below. This block:
- still calls `buildAlwaysInjectedBlock` (pinned facts/prefs),
- adds an auto-recall block using the latest user message,
- appends a save-check nudge on every 4th user turn,
- fires `retryPendingVectors(5)` best-effort.

```typescript
  // ── Memory: always-on injection + per-turn auto-recall + save nudge ──
  // buildAlwaysInjectedBlock — pinned facts + preferences (cap 50/50).
  // getRecallContext — top-3 over threshold 0.7 against the user's latest
  //   message (excludes already-pinned types).
  // Nudge — every 4th user turn, opaque save-check the model can act on.
  // retryPendingVectors — best-effort: re-embed up to 5 entries that
  //   failed indexing previously. Fire-and-forget; doesn't block.
  const memBlock = await buildAlwaysInjectedBlock();
  const lastUser = [...clientMsgs]
    .reverse()
    .find((m) => m.role === "user");
  const userMessageText = (() => {
    const c = lastUser?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c
        .filter((p): p is { type: "text"; text: string } => p?.type === "text")
        .map((p) => p.text)
        .join(" ");
    }
    return "";
  })();
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
```

> **Note on the `ClientMsg` content shape:** `ClientMsg` is defined in `src/lib/toolLoop.ts`. Quickly inspect it (`grep -n "type ClientMsg" src/lib/toolLoop.ts`) — content is either `string` or an array of parts including text and image. The IIFE above handles both.

- [ ] **Step 3: Verify ClientMsg content shape and adjust if needed**

Run: `cd /srv/work/sahayak && grep -A 20 "export type ClientMsg" src/lib/toolLoop.ts`

If `ClientMsg.content` is exclusively `string` (no array form), simplify the IIFE to:

```typescript
  const userMessageText =
    typeof lastUser?.content === "string" ? lastUser.content : "";
```

- [ ] **Step 4: Typecheck**

Run: `cd /srv/work/sahayak && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Smoke against the dev server**

Start the dev server if not running: `cd /srv/work/sahayak && npm run dev`. Then in the browser, open an existing assistant, ask a question that touches a known memory (e.g. "what's the python venv path?"). Observe in the network tab that `/api/chat` returns; the answer should reference the venv. Server-side, transient log lines from `getRecallContext`'s embed call shouldn't appear (it's quiet on success); failure mode would be `"recall: embed failed"` if you want to add a console.warn for visibility — but skip that to stay quiet.

For the nudge: have a 4-turn conversation with one passing user-asserted preference (e.g. "by the way, I always like one-line summaries"). At turn 4, watch for the model to silently call `remember` with that preference.

- [ ] **Step 6: Commit**

```bash
cd /srv/work/sahayak
git add src/app/api/chat/route.ts
git commit -m "$(cat <<'EOF'
chat route: per-turn auto-recall + save nudge

Compose system prompt as: pinned facts/prefs + auto-recalled
top-3 (procedural & friends) + assistant base prompt + a save-
check nudge on every 4th user turn. Best-effort retry of
vectorPending entries on each request.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Tighten `remember` tool description + soft cap

**Files:**
- Modify: `src/lib/tools/memory.ts` (lines 9, 17-47)

- [ ] **Step 1: Restrict the `type` enum to active types**

At `src/lib/tools/memory.ts:6-9`, replace:

```typescript
import { MEMORY_TYPES, type MemoryType } from "@/lib/types";
import { err, ok, type ToolSpec } from "./types";

const TYPE_ENUM = MEMORY_TYPES as readonly string[];
```

with:

```typescript
import {
  ACTIVE_MEMORY_TYPES,
  MEMORY_TYPES,
  type MemoryType,
} from "@/lib/types";
import { err, ok, type ToolSpec } from "./types";

const TYPE_ENUM = MEMORY_TYPES as readonly string[];
const ACTIVE_TYPE_ENUM = ACTIVE_MEMORY_TYPES as readonly string[];
```

- [ ] **Step 2: Replace the `remember` tool spec**

Replace the entire `export const remember: ToolSpec = {` block (lines 17-47) with:

```typescript
const SOFT_CAP = 200;

export const remember: ToolSpec = {
  name: "remember",
  group: "memory",
  description:
    "Save a durable memory about the user. " +
    "Save ONLY: stable facts about the user or their environment they have asserted; lasting preferences they have stated; commands or how-tos the user wants you to reuse across sessions. " +
    "Do NOT save: third-party facts you can re-derive (stock symbols, news, public knowledge); session content (what we just discussed, current task state); anything the user did not explicitly assert about themselves or their setup. " +
    "If unsure, do not save — memory is for the user, not the world. " +
    "Memory is auto-recalled before every turn, so duplicates are silently absorbed; you do not need to search before saving.",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description:
          "fact = stable truth about the user/their setup; preference = how they like things; procedural = a command or how-to to reuse",
        enum: [...ACTIVE_TYPE_ENUM],
      },
      content: {
        type: "string",
        description:
          "The memory itself, one or two short sentences. Concrete and self-contained — should make sense read cold, out of context.",
      },
    },
    required: ["type", "content"],
  },
  async handler(args) {
    const type = coerceType(args.type);
    if (!type) {
      return err(
        "bad_type",
        `type must be one of ${ACTIVE_TYPE_ENUM.join(",")}`,
      );
    }
    const content = String(args.content ?? "").trim();
    if (!content) return err("empty_content", "content is required");
    const result = await createMemory({ type, content, source: "model" });
    const total = (await listMemories()).length;
    const out: Record<string, unknown> = {
      id: result.entry.id,
      type: result.entry.type,
      content: result.entry.content,
      status: result.status,
    };
    if (total > SOFT_CAP) out.pleaseReview = true;
    return ok(out);
  },
};
```

The `coerceType` helper a few lines above stays as-is — it accepts any `MEMORY_TYPES` value, so legacy types still parse if the model ever emits them; we just don't *advertise* them via the enum any more.

- [ ] **Step 3: Verify the tool description shows up correctly**

```bash
curl -s http://localhost:9999/api/tools | jq '.tools[] | select(.name=="remember")'
```

Expected: `description` contains "Save a durable memory about the user", and the JSON-schema `parameters.properties.type.enum` is `["fact","preference","procedural"]`.

- [ ] **Step 4: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/tools/memory.ts
git commit -m "$(cat <<'EOF'
remember tool: high-bar description + 3-type enum + soft cap

Tool description now draws a sharp line on what counts as
memory and what doesn't. Enum restricted to fact/preference/
procedural for new writes (legacy types still parse via
coerceType for back-compat). pleaseReview flag set when
total > 200.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Update archetype system prompts

**Files:**
- Modify: `src/lib/archetypes.ts` (GENERAL block at lines 12-60; SOFTWARE_ENGINEER block at lines 80-124)

- [ ] **Step 1: Replace the lookup-priority + memory paragraphs in `GENERAL_SYSTEM_PROMPT`**

In `src/lib/archetypes.ts`, find the `Lookup priority — check what you have before reaching outside` heading (around line 15) and replace lines 15-18 with:

```
Lookup priority — check what you have before reaching outside
- Memory is auto-recalled before every turn — when relevant past notes exist, they appear in the system prompt under "Possibly relevant from memory". You do NOT need to call recall_memory unless the user explicitly asks "what do you remember about X".
- For time-sensitive topics (recent events, current versions, prices, news), use web_search.
- Don't web_search facts that are stable and inside your training cutoff (math, language, well-known APIs).
```

- [ ] **Step 2: Replace the `Memory — cross-session notes about the user` block in `GENERAL_SYSTEM_PROMPT`**

Find the `Memory — cross-session notes about the user` heading (around line 46) and replace through the end of that section (the line ending with `Types: fact | preference | episodic | procedural | event | semantic.`) with:

```
Memory — cross-session notes about the user
- Memory is about the *user*, not the world. Use web_search for facts about the world; use remember only for things the user has asserted about themselves or their setup that should outlive this session.
- The pinned facts + preferences block above is always current — respect it. Possibly-relevant procedurals and edge cases will appear under "Possibly relevant from memory" when applicable.
- list_memories({type?}) — use only when the user explicitly asks "what do you remember" / "what have I noted".
- remember({type, content}) — call when the user explicitly asks ("remember that…", "from now on…") or states something clearly stable and personal (a name, a working environment, a CLI/path/procedure they want reused). Server-side dedup absorbs near-duplicates, so you can save without first searching. Types: fact | preference | procedural.
```

- [ ] **Step 3: Replace the analogous blocks in `SOFTWARE_ENGINEER_SYSTEM_PROMPT`**

Find the `Lookup priority — check what you have before reaching outside` heading (around line 79) and replace lines 79-82 with:

```
Lookup priority — check what you have before reaching outside
- Memory is auto-recalled before every turn — relevant past sessions on this codebase will appear in the system prompt under "Possibly relevant from memory". You do NOT need to call recall_memory unless the user explicitly asks "what do you remember about X".
- If the topic is time-sensitive (a library's current version, a recent API change), use web_search then web_fetch for docs.
- Don't web-search well-known stable APIs you already know.
```

Find the `Memory — cross-session notes about the user` heading (around line 121) and replace lines 121-124 with:

```
Memory — cross-session notes about the user
- Pinned facts + preferences are above. Possibly-relevant procedurals/notes will appear under "Possibly relevant from memory" when applicable. Don't call recall_memory unless the user explicitly asks.
- remember({type, content}) — call when the user explicitly asks or states something clearly stable about themselves or their setup. Server-side dedup absorbs near-duplicates. Types: fact | preference | procedural.
```

- [ ] **Step 4: Typecheck**

Run: `cd /srv/work/sahayak && npx tsc --noEmit`
Expected: no errors (this is a string-only change).

- [ ] **Step 5: Note the back-compat caveat in the commit**

Existing user-created assistants have their `systemPrompt` baked in at create time. Updating the archetype only affects newly-created assistants and the `/api/assistants/defaults` endpoint. Existing assistants will keep their prompts until the user manually re-applies an archetype via the assistant editor. This is intentional (matches CLAUDE.md note: assistants are user-driven once created).

- [ ] **Step 6: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/archetypes.ts
git commit -m "$(cat <<'EOF'
archetypes: rewrite memory section for auto-recall

The general + software-engineer archetypes now tell the model
that memory is auto-recalled (no need to call recall_memory),
that memory is about the user not the world, and that the
remember enum is fact|preference|procedural with server-side
dedup. Existing assistants keep their old prompt until the
user re-applies an archetype.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: MemoryPage — type filter chips + `lastRecalledAt`

**Files:**
- Modify: `src/components/MemoryPage.tsx`

- [ ] **Step 1: Update imports**

At `src/components/MemoryPage.tsx:7`, replace:

```typescript
import { MEMORY_TYPES, type MemoryEntry, type MemoryType } from "@/lib/types";
```

with:

```typescript
import {
  ACTIVE_MEMORY_TYPES,
  MEMORY_TYPES,
  type ActiveMemoryType,
  type MemoryEntry,
  type MemoryType,
} from "@/lib/types";
import { fmtRelative } from "@/lib/fmt";
```

(the second import is already present near the top — leave it; re-importing in the union is just for clarity. If there's a duplicate, dedupe.)

- [ ] **Step 2: Restrict the add-memory `<select>` to `ACTIVE_MEMORY_TYPES`**

At `src/components/MemoryPage.tsx:27`, replace:

```typescript
  const [addType, setAddType] = useState<MemoryType>("fact");
```

with:

```typescript
  const [addType, setAddType] = useState<ActiveMemoryType>("fact");
```

In the `<select>` JSX (around line 246), replace:

```tsx
            {MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
```

with:

```tsx
            {ACTIVE_MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
```

- [ ] **Step 3: Add type filter chips**

After the search section closes (right after `</section>` at the end of the search block, around line 318), add:

```tsx
      <section className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setTypeFilter(null)}
          className={cn(
            "rounded-full border px-3 py-1 font-mono text-[11px]",
            typeFilter === null
              ? "border-accent bg-accent/10 text-accent"
              : "border-border text-fg-muted hover:border-accent",
          )}
        >
          all · {totals.total}
        </button>
        {MEMORY_TYPES.map((t) => {
          const n = totals.byType[t];
          if (n === 0) return null;
          const isActive =
            (ACTIVE_MEMORY_TYPES as readonly string[]).includes(t);
          return (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                "rounded-full border px-3 py-1 font-mono text-[11px]",
                typeFilter === t
                  ? "border-accent bg-accent/10 text-accent"
                  : isActive
                    ? "border-border text-fg-muted hover:border-accent"
                    : "border-border/50 text-fg-subtle italic hover:border-accent",
              )}
            >
              {t} · {n}
            </button>
          );
        })}
      </section>
```

Add the state hook near the other `useState` calls (around line 33):

```typescript
  const [typeFilter, setTypeFilter] = useState<MemoryType | null>(null);
  const [recalledMap, setRecalledMap] = useState<Record<string, number>>({});
```

- [ ] **Step 4: Fetch the recalled-at map alongside memories**

Modify `refresh()` (around line 36) to also load the recall map:

```typescript
  async function refresh() {
    const r = await fetch("/api/memory");
    const d = (await r.json()) as { memories: MemoryEntry[] };
    setMemories(d.memories);
    try {
      const rr = await fetch("/api/memory/recalled-at");
      if (rr.ok) {
        const dd = (await rr.json()) as { recalledAt: Record<string, number> };
        setRecalledMap(dd.recalledAt ?? {});
      }
    } catch {
      // best-effort; UI still renders without recall stats
    }
  }
```

- [ ] **Step 5: Add the `/api/memory/recalled-at` endpoint**

Create `src/app/api/memory/recalled-at/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getRecalledAtMap } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ recalledAt: await getRecalledAtMap() });
}
```

- [ ] **Step 6: Apply the filter and surface `lastRecalledAt` on each card**

In the rendering section (around `MEMORY_TYPES.map((t) => {` at line 334), wrap the iteration so it respects the filter and uses `MEMORY_TYPES` so legacy types still appear if any exist:

```tsx
          {MEMORY_TYPES.map((t) => {
            if (typeFilter && typeFilter !== t) return null;
            const items = grouped[t];
            if (items.length === 0) return null;
            // ...rest of the existing section unchanged...
```

Then on each `<li>` (around line 351), in the metadata strip alongside `fmtRelative(m.updatedAt)`, add:

```tsx
                        <span className="hidden flex-shrink-0 font-mono text-[10.5px] tabular-nums text-fg-subtle sm:inline">
                          {recalledMap[m.id]
                            ? `recalled ${fmtRelative(recalledMap[m.id])}`
                            : "never recalled"}
                        </span>
```

(Place it right before the existing `fmtRelative(m.updatedAt)` span so updated time still anchors the right edge.)

- [ ] **Step 7: Smoke-test in the browser**

Run `npm run dev` and visit `http://localhost:9999/memory`:
- Filter chips render along with counts.
- Active types (fact/preference/procedural) look normal; legacy types (episodic/event/semantic), if any exist, render in italics with subtler styling.
- Each card shows "never recalled" until the chat route surfaces them; after a chat turn that auto-recalled an entry, refresh and observe the `recalled <relative-time>` line.
- The add-memory `<select>` shows only the 3 active types.

- [ ] **Step 8: Commit**

```bash
cd /srv/work/sahayak
git add src/components/MemoryPage.tsx src/app/api/memory/recalled-at/route.ts
git commit -m "$(cat <<'EOF'
MemoryPage: type filter chips + lastRecalledAt

Filter chips for all 6 types (legacy ones styled subtler so
the user can spot+migrate them); add-form select restricted
to fact/preference/procedural; each card shows
"recalled <relative>" sourced from a new GET /api/memory/
recalled-at endpoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: SettingsPage — Memory health row

**Files:**
- Modify: `src/components/SettingsPage.tsx`

- [ ] **Step 1: Add the section state**

Near the other `useState` calls inside `SettingsPage` (around line 39), add:

```typescript
  const [memoryHealth, setMemoryHealth] = useState<{
    total: number;
    indexed: number;
    pending: number;
    lastRebuildAt: number | null;
  } | null>(null);
  const [rebuildingMem, setRebuildingMem] = useState(false);

  async function loadMemoryHealth() {
    try {
      const r = await fetch("/api/memory/health");
      if (r.ok) setMemoryHealth(await r.json());
    } catch {
      // best-effort; UI shows skeleton
    }
  }

  async function rebuildMemoryIndex() {
    setRebuildingMem(true);
    try {
      await fetch("/api/memory/rebuild", { method: "POST" });
      await loadMemoryHealth();
    } finally {
      setRebuildingMem(false);
    }
  }
```

- [ ] **Step 2: Load on mount**

In the existing `useEffect` (around line 86) that already calls `loadCleanup`, add:

```typescript
    loadMemoryHealth();
```

so the effect becomes:

```typescript
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { settings: Settings }) => setSettings(d.settings));
    loadCleanup();
    loadMemoryHealth();
  }, []);
```

- [ ] **Step 3: Render the Memory health section**

Add a new `<section>` immediately above the existing `Storage cleanup` section (so `git diff` is local). Insert before the line that opens that section (around line 141):

```tsx
      <section className="mt-6 rounded-lg border border-border bg-bg-elev p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="byline">Memory health</h2>
          <button
            onClick={loadMemoryHealth}
            className="tt flex items-center gap-1 rounded border border-border px-2 py-0.5 font-sans text-[10.5px] text-fg-muted hover:border-accent hover:text-fg"
            data-tip="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
        {memoryHealth ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="total" value={memoryHealth.total} />
            <Stat label="indexed" value={memoryHealth.indexed} />
            <Stat
              label="pending"
              value={memoryHealth.pending}
              warn={memoryHealth.pending > 0}
            />
            <Stat
              label="last rebuild"
              value={
                memoryHealth.lastRebuildAt
                  ? fmtRelative(memoryHealth.lastRebuildAt)
                  : "—"
              }
            />
          </div>
        ) : (
          <div className="font-serif italic text-fg-muted">loading…</div>
        )}
        {memoryHealth && memoryHealth.pending > 0 && (
          <p className="mt-3 font-serif text-[12.5px] italic text-fg-muted">
            {memoryHealth.pending} entr
            {memoryHealth.pending === 1 ? "y is" : "ies are"} unindexed —
            usually because Ollama or the embed model was unavailable when
            saved. They&apos;ll be retried on every chat turn; or hit Rebuild.
          </p>
        )}
        <div className="mt-3">
          <button
            onClick={rebuildMemoryIndex}
            disabled={rebuildingMem}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 font-sans text-[11.5px] text-fg-muted hover:border-accent hover:text-fg disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", rebuildingMem && "animate-spin")}
            />
            {rebuildingMem ? "rebuilding…" : "Rebuild index"}
          </button>
        </div>
      </section>
```

- [ ] **Step 4: Add the small `Stat` helper at the bottom of the file**

Append to `src/components/SettingsPage.tsx`:

```tsx
function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number | string;
  warn?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-bg p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-[16px] tabular-nums",
          warn ? "text-amber-600 dark:text-amber-400" : "text-fg",
        )}
      >
        {value}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add `fmtRelative` import if it isn't already there**

Check the existing imports at the top of `SettingsPage.tsx`. If `fmtRelative` is not imported, add:

```typescript
import { fmtRelative } from "@/lib/fmt";
```

- [ ] **Step 6: Smoke**

Visit `http://localhost:9999/settings`. Verify:
- Memory health row shows `total`, `indexed`, `pending`, `last rebuild`.
- Click Rebuild — counts refresh.

- [ ] **Step 7: Commit**

```bash
cd /srv/work/sahayak
git add src/components/SettingsPage.tsx
git commit -m "$(cat <<'EOF'
SettingsPage: Memory health row

Shows total / indexed / pending / last-rebuild and a Rebuild
button. Pending count surfaces in amber with an explanatory
note so users know why an entry didn't index.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Migration script for legacy types

**Files:**
- Create: `scripts/migrate-memory-types.ts`

- [ ] **Step 1: Create the script**

```typescript
#!/usr/bin/env tsx
/**
 * Opt-in migration of legacy memory types.
 *
 * Reads .config/memory.jsonl and produces a new log where:
 *   - episodic, event entries are dropped
 *   - semantic entries are retyped to procedural if they reference a
 *     command/path/CLI; otherwise dropped
 *   - fact, preference, procedural entries pass through unchanged
 *
 * Without --apply, prints the plan to stdout and exits.
 * With --apply, backs up the original log to memory.jsonl.bak-<ts>
 * and writes the migrated log in place.
 *
 * The script does NOT run automatically. Users opt in by running:
 *   npx tsx scripts/migrate-memory-types.ts          # dry-run
 *   npx tsx scripts/migrate-memory-types.ts --apply  # commit
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const CONFIG_DIR = process.env.SAHAYAK_CONFIG_DIR ?? path.join(ROOT, ".config");
const LOG = path.join(CONFIG_DIR, "memory.jsonl");

type Entry = {
  id: string;
  type: string;
  content: string;
  source: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
};
type CreateRec = { op: "create"; entry: Entry };
type UpdateRec = {
  op: "update";
  id: string;
  content: string;
  type?: string;
  updatedAt: number;
  vectorPending?: boolean;
};
type DeleteRec = { op: "delete"; id: string; at: number };
type Rec = CreateRec | UpdateRec | DeleteRec;

const COMMAND_HINTS = [
  "/", // any path
  "$(", "&&", "||", "|",
  "bash", "zsh", "sh ", "exec",
  "curl", "wget", "git ",
  "npm", "npx", "yarn", "pnpm",
  "python", "node ", "ruby",
  "venv", ".env", "PATH=",
  "--", "-n ", "-h ", "-v",
];

function shouldRetypeSemanticToProcedural(content: string): boolean {
  const c = content.toLowerCase();
  return COMMAND_HINTS.some((h) => c.includes(h.toLowerCase()));
}

function classify(entry: Entry): "keep" | "drop" | "retype-procedural" {
  switch (entry.type) {
    case "fact":
    case "preference":
    case "procedural":
      return "keep";
    case "episodic":
    case "event":
      return "drop";
    case "semantic":
      return shouldRetypeSemanticToProcedural(entry.content)
        ? "retype-procedural"
        : "drop";
    default:
      return "keep";
  }
}

function main() {
  const apply = process.argv.includes("--apply");
  if (!fs.existsSync(LOG)) {
    console.error(`No memory log at ${LOG}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(LOG, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const records: Rec[] = lines.map((l) => JSON.parse(l) as Rec);

  // Replay to a live id-set + entry map so we know what ends up live.
  const live = new Map<string, Entry>();
  for (const r of records) {
    if (r.op === "create") live.set(r.entry.id, { ...r.entry });
    else if (r.op === "update") {
      const cur = live.get(r.id);
      if (cur) {
        cur.content = r.content;
        if (r.type) cur.type = r.type;
        cur.updatedAt = r.updatedAt;
      }
    } else if (r.op === "delete") {
      live.delete(r.id);
    }
  }

  const decisions: { id: string; type: string; action: string; preview: string }[] = [];
  const idsToDrop = new Set<string>();
  const idsToRetype = new Map<string, string>();

  for (const e of live.values()) {
    const decision = classify(e);
    decisions.push({
      id: e.id,
      type: e.type,
      action: decision,
      preview: e.content.slice(0, 80),
    });
    if (decision === "drop") idsToDrop.add(e.id);
    else if (decision === "retype-procedural")
      idsToRetype.set(e.id, "procedural");
  }

  console.log(`Total live memories: ${live.size}`);
  console.log(`To drop: ${idsToDrop.size}`);
  console.log(`To retype → procedural: ${idsToRetype.size}`);
  console.log(`Unchanged: ${live.size - idsToDrop.size - idsToRetype.size}`);
  console.log("");
  for (const d of decisions) {
    console.log(`  [${d.action.padEnd(18)}] ${d.type.padEnd(10)} ${d.id}  ${d.preview}`);
  }

  if (!apply) {
    console.log("");
    console.log("Dry run only. Re-run with --apply to commit.");
    return;
  }

  const backupPath = `${LOG}.bak-${Date.now()}`;
  fs.copyFileSync(LOG, backupPath);
  console.log("");
  console.log(`Backed up original to ${backupPath}`);

  // Append delete records for drops, update records for retypes.
  // We don't rewrite the existing log — append-only keeps history clean
  // and reversible by hand.
  const now = Date.now();
  const appended: string[] = [];
  for (const id of idsToDrop) {
    appended.push(JSON.stringify({ op: "delete", id, at: now } satisfies DeleteRec));
  }
  for (const [id, newType] of idsToRetype) {
    const cur = live.get(id);
    if (!cur) continue;
    appended.push(
      JSON.stringify({
        op: "update",
        id,
        content: cur.content,
        type: newType,
        updatedAt: now,
      } satisfies UpdateRec),
    );
  }
  fs.appendFileSync(LOG, appended.join("\n") + (appended.length ? "\n" : ""));
  console.log(`Appended ${appended.length} migration record(s) to ${LOG}.`);
  console.log("Tip: hit Rebuild on the settings page to re-embed.");
}

main();
```

- [ ] **Step 2: Verify the script runs in dry-run mode**

```bash
cd /srv/work/sahayak
npx tsx scripts/migrate-memory-types.ts
```

Expected: a per-entry decision list and counts at the top. No file changes.

- [ ] **Step 3: Commit (do NOT run with `--apply` here — leave that to the user)**

```bash
cd /srv/work/sahayak
git add scripts/migrate-memory-types.ts
git commit -m "$(cat <<'EOF'
scripts: opt-in migration of legacy memory types

Reads memory.jsonl, classifies each live entry, and on
--apply appends delete/update records that drop episodic/
event entries and retype command-shaped semantic entries
to procedural. Backs up the original log. Not run on app
start — users opt in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (against the spec)

- **Spec §1 type taxonomy → 3:** Tasks 1, 8, 10. `MEMORY_TYPES` deliberately retained for read-tolerance per spec migration note ("treats unknown types as fact for the purpose of auto-injection"). Plan goes one step further and shows legacy entries to the user so they can migrate explicitly.
- **Spec §2 high-bar `remember` + dedup:** Tasks 2 (dedup) and 8 (description rewrite + soft cap).
- **Spec §3 always-on auto-recall:** Tasks 5 (`getRecallContext`) and 7 (chat-route wiring).
- **Spec §4 inline pre-reply nudge every 4 turns:** Task 7. Counter derived from `clientMsgs.filter(role==='user').length` — no Map needed; survives server restart naturally.
- **Spec §5 reliability (no silent embed failures):** Task 3 (`vectorPending` flow + retry helper) and Task 7 (chat route fires the retry per request).
- **Spec §6 UI minimal:** Task 10 (filter chips + recalled-at) and Task 11 (Settings memory health).
- **Spec §7 `lastRecalledAt` in sidecar, not main log:** Task 4.
- **Spec §8 system-prompt edits:** Task 9.

**Placeholder scan:** none — every code change shows the actual code, every verification step shows the actual command and expected output.

**Type consistency:** `CreateResult.status` matches the JSON field returned by `/api/memory` POST and the `remember` tool result. `getMemoryHealth`'s shape matches the `Stat` rendering on SettingsPage. `getRecalledAtMap` returns `Record<string, number>` which matches the `recalledAt` payload consumed by MemoryPage.

**Off-spec but pragmatic additions:**
- Plan shows legacy-typed entries in MemoryPage with subtler styling rather than hiding them — gives the user a path to manually migrate without running the script.
- Per-request pending-vector retry capped at 5 to keep request latency bounded.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-30-memory-recall-and-generation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

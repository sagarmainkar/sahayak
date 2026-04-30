# Memory: better recall, fewer noisy writes

**Date:** 2026-04-30
**Scope:** the memory subsystem only — `src/lib/memory.ts`, `src/lib/tools/memory.ts`, the `MemoryEntry` shape in `src/lib/types.ts`, the chat-route integration, and the related slice of the system prompt in `src/lib/store.ts`. Out of scope: any of the other five open-source-prep items (mobile UI, outputs dir, artifact images, README, peer-agent).

## Problem

The current memory system has two distinct failure modes that the JSONL log makes obvious:

1. **Recall doesn't fire when it should.** `recall_memory` is a tool the model has to *choose* to call. The system prompt asks it to "check memory before searching online," but the model often skips that step, especially for `procedural`/`semantic` types that aren't covered by the always-injected fact+preference block.
2. **Writes are too eager and not deduplicated.** The same content gets saved repeatedly within a single turn (e.g. five copies of "User prefers news in 6 categories…" 12 seconds apart), and content that isn't really memory at all (stock symbols, public knowledge) ends up in the log because the tool description doesn't draw a sharp line.

A third, real but less central, issue: silent indexing failures. If `nomic-embed-text` is unavailable at write time, the entry is created without a vector and is unsearchable until manual `rebuildVectors`. The user has no signal that this happened.

## Goal

Memory feels like it "just works": things the user told the assistant resurface naturally, the log stays small enough to inspect by hand, and write quality is high enough that listing the memories is interesting rather than embarrassing.

## Non-goals

- A best-in-class memory system. We are building the local-first, single-user, JSONL-backed version that's good enough to make Sahayak's open-source release feel cared-for.
- Auto-extraction of memories from conversation by an offline batch job.
- Per-assistant memory scoping. The pool stays global to the user.
- Any change to the always-injected fact/preference block's existing role.

## Design

### 1. Type taxonomy: collapse 6 → 3

The current taxonomy is `fact / preference / episodic / procedural / event / semantic`. The model demonstrably can't keep these straight — the log shows the same content stored once as `fact` and once as `preference`, and the `semantic` bucket has been used as a junk drawer for stock-data scratchpad.

**New taxonomy:**

| Type | Meaning | Example |
| --- | --- | --- |
| `fact` | Stable truth about the user or their environment | "Name is Sagar; lives in Pune (IST); hardware is A10G EC2" |
| `preference` | How the user likes things done | "News in 6 categories with emoji + tables" |
| `procedural` | A specific command or how-to the model should reuse | "Twitter via `bird` CLI; creds at `.config/twitter.json`; pattern: `bird --auth-token … <cmd> --json`" |

`MEMORY_TYPES` in `src/lib/types.ts` shrinks to those three.

**Migration of existing entries:**

- `episodic` → delete (we're not treating dated experiences as memory anymore — chat sessions cover that).
- `event` → delete (same reason).
- `semantic` → if content references a command/path/CLI, retype to `procedural`; otherwise delete.

A one-shot migration script (`scripts/migrate-memory-types.ts`) reads the JSONL, emits per-entry decisions to stdout, waits for confirmation, then writes a new log with create/delete records that resolve to the migrated state. The original log is preserved with a `.bak-<timestamp>` suffix. The script is **opt-in** — it is not run automatically on app start. Existing installs without the script run continue to see legacy types in the JSONL log; the runtime treats unknown types as `fact` for the purpose of auto-injection.

### 2. Write path: high-bar `remember` with server-side dedup

The `remember` tool's description is rewritten to draw a sharp line:

> Save a durable memory. **Save ONLY:**
> - stable facts about the user or their working environment they have asserted,
> - lasting preferences they have stated,
> - commands or how-tos the user wants you to reuse across sessions.
>
> **Do NOT save:**
> - third-party facts you can re-derive (stock symbols, news, public knowledge),
> - session content (what we just discussed, current task state),
> - anything the user did not explicitly assert about themselves or their setup.
>
> If unsure, do not save. Memory is for the user, not the world.

Server-side dedup is added inside `createMemory` in `src/lib/memory.ts`:

1. Embed the candidate content.
2. Score against the existing vector sidecar.
3. If `max(cosine) > 0.92`, return `{ status: "already_known", id: <existing>, content: <existing.content> }` to the tool caller — no new row is appended to the log.
4. Otherwise, append-create as today.

The dedup threshold (0.92) is conservative on purpose — it catches near-duplicates without merging genuinely distinct entries.

A soft cap is added: when `listMemories().length > 200`, the tool result includes `pleaseReview: true`. The system prompt mentions this flag once and asks the model to suggest pruning when it appears.

### 3. Recall path: always-on auto-recall before each user turn

A new function in `src/lib/memory.ts`:

```
getRecallContext(userMessage: string, opts?: {
  k?: number;             // default 3
  threshold?: number;     // default 0.7
  excludePinnedTypes?: boolean; // default true — skip fact + preference (already always-injected)
}): Promise<string>
```

It embeds `userMessage`, scores against the vector sidecar, takes top-k entries above `threshold`, optionally skips types that are already in the always-injected block, and returns a formatted string:

```
Possibly relevant from memory:
- [procedural] Python venv at ~/.sahayak/python_code/.venv
- [fact] Sagar lives in Pune (IST)
```

…or `""` if no hits qualify.

The chat route (`src/app/api/chat/route.ts`) calls `getRecallContext` once at the start of each user turn, before the first Ollama call, and prepends the result to the system prompt for that turn only. The auto-recalled block is **not** persisted into the session messages — it's transient context.

Token budget is bounded by the (k, threshold) pair: with k=3 and ~100-token entries, this caps at ~300 tokens. If no entries qualify, nothing is injected.

The existing `buildAlwaysInjectedBlock` in `src/lib/memory.ts` is unchanged. It continues to inject all `fact` + `preference` entries (cap 50 each). Auto-recall is additive on top — it's where `procedural` entries surface, plus rare cases where a fact/pref is so on-topic it's worth duplicating.

The `recall_memory` tool stays. It's the path for explicit "what do you remember about X" questions and for the model to dig deeper when the auto-recalled block hints at something useful.

### 4. Save-check nudge: inline pre-reply, every 4 user turns

Track per-session user-turn count in process memory inside the chat route — no persistence; this resets on server restart and that's fine.

On the 4th, 8th, 12th… user turn (i.e. when `userTurnCount % 4 === 0`), append one terse line to the **trailing end of the per-turn system content** — after the assistant's base system prompt and the auto-recall block — so it's the last instruction the model sees before the user message:

```
[memory check: if anything durable about the user, their environment, or their lasting
 preferences has emerged in this conversation that wasn't already saved, call remember
 now. Otherwise reply normally.]
```

The model decides. If it calls `remember`, server-side dedup absorbs accidental near-duplicates. If it doesn't, nothing happens.

This adds ~30 tokens, only on every 4th turn, and is invisible to the user. There is no UI surface for the nudge.

### 5. Reliability: no more silent indexing failures

`createMemory` currently writes the entry, then best-effort embeds, then best-effort appends to the vector sidecar. If embedding fails, the entry exists but is unsearchable forever (until manual `rebuildVectors`).

Change:

- Add a `vectorPending: true` flag to `MemoryEntry` (optional field on the type).
- If embedding fails inside `createMemory`, persist the entry with `vectorPending: true` instead of swallowing the failure.
- On every chat-route invocation, do a low-priority retry: list memories with `vectorPending: true`, attempt to embed each (cap at e.g. 5 per turn to bound work), clear the flag and append to the vector sidecar on success.
- Same retry strategy for `updateMemory`.

The `vectorPending` flag is also surfaced on the settings page (next section).

### 6. UI: minimal additions

**`src/components/SettingsPage.tsx` — new "Memory health" row:**

- `total` (count from `listMemories`)
- `indexed` (count from vector sidecar)
- `pending` (count where `vectorPending === true`)
- `lastRebuildAt` (stored alongside the vector sidecar in a tiny `meta.json`)
- Button: **Rebuild index** → calls existing `rebuildVectors`.

**`src/components/MemoryPage.tsx`:**

- Filter chips at the top for the three types (`fact / preference / procedural`).
- Each memory card shows `lastRecalledAt` if set, formatted as "recalled 3d ago" / "never recalled". Lets the user spot dead weight to delete.

**Chat:** no UI signal for auto-recall or for the nudge. The whole subsystem is opaque to the user during normal use. Curious users find it in the JSONL.

### 7. `lastRecalledAt` storage — keep the log clean

The naive approach (write a JSONL update record every time an entry is recalled) would explode the log. Instead, `lastRecalledAt` is stored in the **vector sidecar** rather than the main log. The sidecar is already fully-rewritten on update/delete, so adding a per-entry timestamp there is cheap and doesn't affect the log's auditability.

Sidecar record shape becomes:

```
{ "id": "...", "vector": [...], "lastRecalledAt": 1745000000000 }
```

`getRecallContext` updates the sidecar entries it returned (debounced — at most once per minute per id, to avoid hot loops on repeated short queries).

### 8. System-prompt changes (in `src/lib/store.ts`)

Replace the current "check memory before searching online" line with two short clauses:

> Memory is **auto-recalled** before every turn. You will see a "Possibly relevant from memory" block in the system prompt when relevant entries exist. Don't call `recall_memory` unless the user explicitly asks "what do you remember about X."
>
> Memory is **about the user**, not the world. Use `web_search` for facts about the world; use `remember` only for things the user has asserted about themselves or their setup that should outlive this session.

This removes the decision tree the model currently has to navigate ("should I call recall_memory? was it relevant enough?") and replaces it with a hard rule.

## What changes, file by file

- **`src/lib/types.ts`** — shrink `MEMORY_TYPES` to 3; add `vectorPending?: boolean` to `MemoryEntry`.
- **`src/lib/memory.ts`** —
  - dedup inside `createMemory` (cosine > 0.92 → `already_known`),
  - new `getRecallContext` exported,
  - sidecar record gains `lastRecalledAt`; sidecar-rewrite helpers updated,
  - `vectorPending` retry hook (called from chat route),
  - `meta.json` next to the sidecar for `lastRebuildAt`.
- **`src/lib/tools/memory.ts`** — rewrite the `remember` description; surface `pleaseReview` flag; map old types to new.
- **`src/app/api/chat/route.ts`** — call `getRecallContext` per user turn, inject; track per-session user-turn counter, append nudge every 4th turn; call `vectorPending` retry once per turn (capped).
- **`src/lib/store.ts`** — update `DEFAULT_SYSTEM_PROMPT` memory section.
- **`src/components/MemoryPage.tsx`** — type-filter chips; `lastRecalledAt` on cards.
- **`src/components/SettingsPage.tsx`** — Memory health row + Rebuild button.
- **`src/app/api/memory/`** — surface health stats endpoint if not already there.
- **`scripts/migrate-memory-types.ts`** — one-shot migration of existing log.

## Risks and trade-offs

**Auto-recall on every turn costs an embedding call.** With local `nomic-embed-text` this is 30–80ms. Acceptable. If Ollama is down, `getRecallContext` returns `""` silently — recall degrades gracefully.

**The nudge can produce false-positive saves.** Server-side dedup is the safety net. If the model gets enthusiastic during a memory check and saves something redundant, dedup absorbs it.

**Collapsing `episodic`/`event`/`semantic` deletes existing entries.** The migration script preserves a backup of the original log. Anyone who relied on those types can grep the backup.

**Process-memory turn count resets on server restart.** The first 4-turn nudge after a restart fires at turn 4 of the new server lifetime, not turn 4 of the session. Acceptable — the alternative (persisting the counter) trades a feature seam for a tiny UX inconsistency.

**Cosine threshold 0.92 for dedup is empirical.** Will need a tweak if it either fails to catch obvious dupes or merges distinct-but-similar memories. The threshold is a single constant in `memory.ts`; easy to tune.

## Verification

There's no test suite. Verification is manual via `npm run dev`:

1. Fresh memory log: ask the assistant to remember three plausible things in one turn → log gets three rows, no duplicates.
2. Ask it to remember the same thing twice → second call returns `already_known`, no new row.
3. Ask a follow-up question that touches one of the saved memories on a fresh session → answer includes the saved info without an explicit recall call.
4. Have a 4-turn conversation about a topic with one passing user-asserted preference → at turn 4, the assistant calls `remember` for that preference.
5. Rename `nomic-embed-text` temporarily (or stop Ollama briefly), ask to remember something → entry appears with `vectorPending: true`; settings page shows `pending: 1`; restart Ollama, do another turn → pending drops to 0.
6. Visit `MemoryPage`, filter by each of the three types, delete a stale entry — flow works.

## Open items intentionally deferred

- Per-assistant memory scopes (still global).
- Memory editing UI beyond delete (today: edit-in-place is via `updateMemory`; the page may or may not surface this — out of scope for this spec).
- Smarter recall: BM25 hybrid, per-query reranking, etc. The MVP is cosine top-k.
- Auto-summarization of similar entries.

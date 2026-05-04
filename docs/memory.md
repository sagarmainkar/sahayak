# Memory

Cross-session notes the assistant remembers about you. Enabled by default — no setup required beyond pulling `nomic-embed-text` (see [Getting Started](getting-started.md)). Lives in `.config/memory.jsonl`.

## What gets saved

Three types:

- **`fact`** — stable truths about you or your environment. *"Name is Sagar; lives in Pune (IST)."*
- **`preference`** — how you like things. *"News in 6 categories with emojis and tables."*
- **`procedural`** — commands or how-tos to reuse across sessions. *"Use `bird` CLI for X/Twitter; auth at .config/twitter.json."*

The model decides what's worth saving. The `remember` tool's description nudges toward "stable user-asserted facts only — not session content, not third-party world knowledge." A save-check nudge fires every 4th user turn asking the model whether anything durable emerged.

## How it surfaces during chat

Two paths:

- **Always-injected block.** All `fact` and `preference` entries (capped at 50 each) prepend the system prompt on every turn. This is your identity layer — name, location, working environment, lasting preferences. Always visible to the model.
- **Auto-recall.** Before each turn, the user message is embedded via `nomic-embed-text` and scored against every memory's vector. Top-3 entries that score ≥ 0.7 cosine similarity get injected as a "Possibly relevant from memory" block. This is mostly how `procedural` entries surface — when the user asks something that semantically matches a saved how-to.

## Server-side guardrails

- **Dedup at write.** When `remember` is called with content that's near-cosine to an existing memory (≥ 0.92), the server returns `{status: "already_known", id: <existing>}` instead of writing a duplicate. Stops the runaway-write loop.
- **`vectorPending` retry.** If embedding fails at write time (Ollama down, embed model missing), the entry is saved with a `vectorPending: true` flag and retried on the next chat turn (capped at 5 retries per turn). Stops "saved but never recalled" silent failures.
- **Soft cap.** Past 200 entries the `remember` tool returns `pleaseReview: true` so the model can suggest pruning.

## Inspecting memory

The Memory page (`/memory` in the browser) shows:

- All entries grouped by type, with last-recalled timestamps.
- Filter chips by type.
- Bulk-select + delete.
- Semantic search box (live cosine search as you type).
- A "Rebuild index" button that re-embeds everything.

Or hit it directly with `jq`:

```bash
cat .config/memory.jsonl | jq -r 'select(.op == "create") | "\(.entry.type)\t\(.entry.content)"'
```

## Common questions

**Is memory per-assistant or global?** Global — one pool shared across all assistants on this machine. Per-assistant scoping isn't supported in v1.

**Can I edit a memory?** Yes — Memory page → click an entry → edit. Or `PATCH /api/memory/<id>` with new `content` / `type`.

**My recall always returns nothing.** `nomic-embed-text` isn't pulled. `ollama pull nomic-embed-text`, then visit Settings → Memory health → Rebuild index.

**Where's the embedding model run?** Locally, against your Ollama instance. Sahayak doesn't ship embeddings to any cloud.

**Can I disable memory entirely?** Disable the `remember` / `recall_memory` / `list_memories` tools per-assistant in the editor — the model can't write or recall. The always-injected fact/preference block still applies (since you can still add entries via the UI), so to fully disable: tools off + Memory page → bulk-select all → delete.

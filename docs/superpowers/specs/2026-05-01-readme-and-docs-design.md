# README + `docs/` tree for OSS release

**Date:** 2026-05-01
**Scope:** Replace the current 57-line tech-feature-list README with an OSS-grade entry experience, and create a small `docs/` tree for depth (install, architecture, artifacts, templates, memory). Build an examples gallery in `docs/artifacts.md` from 6 of the user's pinned sessions on disk. Out of scope: a launch video / marketing site (separate spec; the README links to it later if it ships); per-feature deep-dive blog posts; an `examples/` directory of standalone runnable artifacts (we inline source in `<details>` blocks instead).

## Problem

Today's [README.md](README.md) is a tech-feature-list aimed at someone who already knows what Sahayak is. It has three concrete problems for an OSS release:

1. **Stale.** Mentions `data/sessions/...` but the actual layout is `.data/<aid>/<sid>/session.jsonl`; doesn't mention `npm run setup:python`, the `.data/.venv` Python pipeline we just shipped, artifacts, templates, memory, or the multi-backend support (Ollama local, Ollama cloud, llama.cpp).
2. **Install is too sparse.** Just `npm install && npm run dev`. No mention of pulling a model, the embed model required for memory, the optional API key, or the now-required `npm run setup:python`.
3. **Nothing visual.** 9 PNG screenshots already exist in `screenshots/` but are never referenced from the README. A first-time visitor can't tell what the app looks like before cloning.

There's also a related need: the user wants an **examples gallery** showing real artifacts (PowerGrid stock dashboard, Shakshuka recipe card, DeepSeek v4 explainer, etc.) so prospective users see what the app produces, distinguish artifacts from templates, and understand which assistant types fit which task.

## Goal

A first-time visitor lands on the README and within 60 seconds knows (a) what Sahayak does, (b) why they'd pick it over OpenWebUI / LibreChat / etc., (c) how to install it, and (d) what the output looks like. If they want depth, they navigate into `docs/` for install troubleshooting, the artifact pipeline, the template system, the memory subsystem, and the architecture overview.

## Non-goals

- A launch video / GIF demo. Separate spec — the marketing surface (typing prompts zoomed in, tools running fast, Ask-to-fix flow, mobile artifact panel, etc.) needs its own brainstorm because the medium is different and the audience (random visitors who haven't cloned yet) is different.
- An `examples/` directory of standalone runnable artifact source files. The docs reference frozen snippets inline; if the user wants to run them they paste into a chat. Keeps the repo lean and avoids drift between the rendered `docs/` and runnable code.
- A documentation site generator (Docusaurus, VitePress, etc.). Plain markdown in `docs/` rendered by GitHub is enough for v1.
- Internationalization. English-only.
- API reference auto-generation. The tool surface is tiny enough that hand-written docs win.
- A `CONTRIBUTING.md`. Out of scope for this push; one-paragraph contribution note in the README is enough.

## Design

### File structure

```
README.md                              # Entry experience (~150 lines)
docs/
  getting-started.md                   # Detailed install + troubleshooting
  architecture.md                      # JSONL model, tools, multi-backend
  artifacts.md                         # Concept + pipeline + 6-example gallery
  templates.md                         # The 3 built-in templates + how to add
  memory.md                            # Auto-recall, save-check nudge, inspecting
screenshots/                           # Existing 9 PNGs, referenced from README and docs
```

No `examples/` directory. Artifact source for the gallery is inlined in `docs/artifacts.md` inside `<details>` blocks so the page stays scannable but full code is one click away.

### README structure (~150 lines)

Seven short sections, scannable:

1. **Hero.** App name, one-line tagline, primary screenshot embedded.
   > *Sahayak — local-first AI chat with interactive artifacts, cross-session memory, and three hand-designed themes. No cloud, no payments, your data stays on your machine.*
2. **Why Sahayak** (4-bullet differentiator). Each ~1-2 lines:
   - **Local-first.** Runs against Ollama / llama.cpp on your machine. No keys, no quotas, no telemetry.
   - **Multi-backend.** Same chat surface, swap engines: local llama.cpp, local Ollama, hosted Ollama Cloud (Kimi, MiniMax, etc.). Per-assistant model + provider config.
   - **Interactive artifacts.** Generates real React components with charts (Recharts) and data (PapaParse) in a sandboxed iframe — not just markdown.
   - **MCP-aware.** Bring your own tool servers via the Model Context Protocol; they appear in the assistant editor like any built-in tool.
3. **60-second install** (numbered, three blocks):
   ```bash
   git clone https://github.com/<...>/sahayak && cd sahayak
   npm install
   npm run setup:python   # Creates .data/.venv with pandas/numpy/yfinance/...
   ```
   ```bash
   # Pull a tool-capable model (one-time)
   ollama pull qwen3.5:9b
   ollama pull nomic-embed-text   # for the memory subsystem
   ```
   ```bash
   npm run dev    # http://localhost:9999
   ```
   *Detail (Windows / Apple Silicon / API keys / per-platform Ollama notes) lives in [docs/getting-started.md](docs/getting-started.md).*
4. **What's in the box** (grouped feature list, each line links into the right docs page):
   - **Chat surface.** Streaming with reasoning, tool-result cards, regenerate, compaction, export.
   - **[Artifacts](docs/artifacts.md).** React components rendered in a sandboxed iframe; data flows from the session via `Sahayak.fetchData()`.
   - **[Templates](docs/templates.md).** Pre-canned response shapes (news digest, itinerary, scorecard); the model fills in JSON, the renderer styles it.
   - **[Memory](docs/memory.md).** Auto-recalled per turn (cosine similarity over `nomic-embed-text`); facts/preferences always visible; opt-in `pip_install`-style write tools.
   - **Tool surface.** Filesystem, shell with auto-prefixed Python venv, web search/fetch, Gmail, MCP servers.
   - **Themes.** Three hand-designed styles × light/dark.
   - **Single-user JSONL storage.** One file per session, inspectable with `cat | jq`. No DB.
5. **Screenshot grid.** 2×3 grid of `screenshots/sahayak_*.png`, each with a short caption. The implementer inspects each of the 9 PNGs and picks the 6 most representative (across chat, artifact, memory, settings, mobile, themes); the unused 3 stay in the dir but unreferenced.
6. **Stack.** Tight 3-line tech list — Next.js 16 + React 19 + TypeScript + Tailwind 4 (CSS-first); Ollama / llama.cpp via `pi-agent-core`; JSONL persistence.
7. **License + contributing.** MIT. One-line "PRs welcome — file an issue first for anything non-trivial."

### `docs/getting-started.md`

- Prerequisites (Node 20+, Python 3.11+, Ollama running).
- Step-by-step install (verbose version of the README's 60-second).
- Pulling a model (qwen3.5:9b, gemma4:26b, etc., with notes on tool-capability).
- Pulling `nomic-embed-text` for memory.
- Optional `OLLAMA_API_KEY` for hosted web search/fetch (Sahayak picks it up from `~/.openclaw/credentials/ollama.json` if present, or env var).
- Optional Gmail tools setup (links to `gmail_agent.py` external).
- Configuring an Ollama Cloud or llama.cpp assistant (per-assistant model + provider).
- MCP server config — how to add one in `.config/mcp.json`.
- Troubleshooting:
  - Ollama not running ("connection refused on :11434").
  - Embed model missing ("memory entries created but never recalled").
  - Python deps fail to install (npm run setup:python error paths).
  - Port 9999 in use.
- Where data lives (`.data/`, `.config/`) and how to back up / move between machines.

### `docs/architecture.md`

- High-level diagram in ASCII or mermaid: chat route → pi-agent-core → Ollama / llama.cpp.
- The JSONL data model — one paragraph each on `assistants.json`, `session.jsonl`, `uploads/`, `artifacts/`, `memory.jsonl`.
- Single-user assumption — no auth, no multi-tenant, deliberately scoped.
- Multi-backend selection (Ollama local / Ollama cloud / llama.cpp via OpenAI-compat).
- Tool architecture — `ToolSpec`, the HITL approval gate, MCP wrapper.
- Brief memory subsystem note (link to `docs/memory.md` for depth).

### `docs/artifacts.md` — concept + 6-example gallery

**Sections:**

1. **What's an artifact?** Two paragraphs. Distinguishes from templates: artifacts are general-purpose React components rendered in an iframe; templates are pre-styled JSON shapes for specific output formats. Mentions Recharts + PapaParse global access, the `Sahayak.fetchData()` bridge, the network sandbox (in/out images allowed, scripts/fetch blocked by prompt convention).

2. **The pipeline.** 4-step bulleted explanation matching `REACT_ARTIFACT_INSTRUCTIONS`: artifact_create → execute_command (data) → artifact_write_file → emit fence with `// id:` + `Sahayak.fetchData('data.csv')`.

3. **Examples gallery** — 6 entries pulled from the user's pinned sessions:

   | # | Example | Assistant | Backend | What it shows |
   |---|---|---|---|---|
   | 1 | Unseen Himachal Pradesh travel itinerary | QWEN3.6-27B-LOCAL-LLAMA | llama.cpp | Long-form prose + visuals; the implementer reads `.data/AAft3EmyUcIT/mnFciB7lhhOd/session.jsonl` to determine whether this turn produced an artifact, used the itinerary template, or stayed in plain prose, and styles the example block accordingly |
   | 2 | PowerGrid stock analysis dashboard | QWEN3.6-27B-LOCAL-LLAMA | llama.cpp | Python venv (yfinance + pandas) + multi-panel artifact + analysis text |
   | 3 | Shakshuka recipe card with hero image | QWEN3.6-27B-LOCAL-LLAMA | llama.cpp | Composition + external HTTPS image (Unsplash) + image hygiene attrs |
   | 4 | Model architectures explainer (no artifact) | QWEN3.6-35B-Local | Ollama local | Pure prose mode — markdown headings, tables, code blocks; shows it doesn't always need an artifact |
   | 5 | Latest news digest | QWEN3.6-35B-Local | Ollama local | The `news` built-in template + `web_search` tool |
   | 6 | DeepSeek v4 interactive explainer | MiniMax | Ollama Cloud | Click-through interactive React artifact + cloud backend |

   Each entry follows this template:

   ```markdown
   ### N. <Title>

   **Assistant:** <name> · **Backend:** <llama.cpp / Ollama local / Ollama Cloud>
   **Tools used:** <list>

   **Prompt:**
   > <verbatim user prompt from session.jsonl>

   ![<alt>](../screenshots/<file>.png)

   <One-paragraph commentary on what's showcased and why it's a good
   example. ~3-4 sentences.>

   <details>
   <summary>Artifact source (collapsed)</summary>

   ```jsx
   // verbatim from .data/<aid>/<sid>/artifacts/<id>/source.jsx
   ```

   </details>
   ```

   For example #4 (no artifact), the `<details>` block is replaced with the actual rendered markdown excerpt instead of JSX.

   For example #5 (template), the `<details>` block shows the template-fill JSON the model emitted.

4. **Adding your own.** One paragraph: "Just ask the assistant. Toggle artifact mode (Sparkles button), describe what you want. The pipeline above happens automatically."

### `docs/templates.md`

- **Concept.** Pre-canned response shapes the model fills in. The model emits a fenced block with template-id + JSON; the renderer styles it. Useful for repeatable formats (news, itineraries, scorecards) where you want consistent visual treatment.
- **The three built-ins** (one section each):
  - `news` — categorical digest. Each section has a heading, a short blurb, optional bullets, optional emoji. Source: `src/lib/templates/news.tsx`. Usage: just ask "give me the latest news on X" with the template enabled.
  - `itinerary` — day-by-day itinerary with timing + budget. Source: `src/lib/templates/itinerary.tsx`.
  - `scorecard` — feature-by-feature comparison grid. Source: `src/lib/templates/scorecard.tsx`.
- **Templates vs. artifacts.** Two-paragraph rule of thumb: templates for repeatable structured formats, artifacts for one-off interactive React components. A scorecard for "compare these 5 phones" → template. A live filterable table of those phones → artifact.
- **Adding your own.** Brief recipe: write a TSX component in `src/lib/templates/`, register in `index.ts`, add to `TEMPLATE_META`. Self-contained — no system-prompt change needed; the registration surfaces it in the composer.

### `docs/memory.md`

Tight summary of what was shipped:

- **Three types** — `fact`, `preference`, `procedural`.
- **Always-injected block** — facts + preferences in every system prompt.
- **Auto-recall** — the user message is embedded each turn; top-3 procedurals over 0.7 cosine surface as "Possibly relevant from memory" in the system prompt.
- **Save-check nudge** — every 4th user turn, the model is silently asked whether anything durable should be saved.
- **Server-side dedup** — duplicate writes return `already_known`.
- **`vectorPending` retry** — entries that failed embedding (Ollama down) get retried automatically.
- **Inspecting / clearing.** `cat .config/memory.jsonl | jq`. Or use the Memory page UI (filter chips by type, delete one, rebuild index).
- **Limitations.** Single-user pool (not per-assistant). Embedding requires `nomic-embed-text` pulled.

### Screenshot reuse

The existing `screenshots/sahayak_1.png` … `_9.png` are unnamed. As part of this work, **rename them descriptively** (`sahayak-chat.png`, `sahayak-artifact-recipe.png`, `sahayak-memory-page.png`, etc.) so the README + docs reference them by intent, not by index. Inspect each PNG during implementation to decide which name fits. Don't take new screenshots — the existing 9 cover most surfaces. If a critical surface is missing (e.g. the new mobile bottom sheet from the mobile-polish work) it's added in a follow-up.

## What changes, file by file

- **`README.md`** — full rewrite per §README structure. Old version replaced.
- **`docs/getting-started.md`** — new file (~120 lines).
- **`docs/architecture.md`** — new file (~80 lines).
- **`docs/artifacts.md`** — new file (~250 lines including the 6 example sections with inline source).
- **`docs/templates.md`** — new file (~80 lines).
- **`docs/memory.md`** — new file (~80 lines).
- **`screenshots/`** — rename existing PNGs to descriptive names; update references.

No code files touched. No tests, builds, or runtime behavior changes.

## Risks and trade-offs

- **Doc drift.** Inlined artifact source freezes a snapshot; if `Sahayak.fetchData` ever changes shape, the inline JSX in `docs/artifacts.md` becomes wrong. Acceptable: the docs say "as of v0.1" or similar, and the source is meant to demonstrate the pattern, not be drop-in runnable.
- **Length.** Six full example sections in `docs/artifacts.md` push that file to ~250 lines. Keeping each under ~40 lines (commentary + collapsed source) keeps the page navigable.
- **Screenshot ages.** PNGs from earlier UI states may not match current rendering (we just shipped mobile-polish + memory + venv). Mitigation: inspect each PNG during implementation; if a screenshot looks dated, drop it from the gallery rather than re-shoot.
- **GitHub markdown rendering quirks.** `<details>` blocks render fine on github.com but not in some legacy IDE markdown previewers. Acceptable — the primary read surface is github.com.
- **Examples that don't actually exist as artifacts.** Example #4 (model architectures, hybrid) was specifically called out as "no artifact" — pure prose. We need to verify by reading session.jsonl that it really is prose-only, then style its example block differently (markdown excerpt instead of JSX). Same for example #5 (template). Implementation step.

## Verification

There is no test suite for docs. Verification is manual:

1. **Open README.md in a github.com preview** (or `gh repo view --web` after pushing). Confirm screenshots load, links navigate, code blocks render.
2. **Click each `[link](docs/...)` in the README** — confirm it opens the right page.
3. **Run through the 60-second install on a clean machine or container** as the README describes — confirm it actually works end-to-end.
4. **Open each `docs/<page>.md`** — confirm internal links navigate, screenshots show, `<details>` blocks expand cleanly.
5. **Cross-check `docs/artifacts.md` examples against the actual sessions on disk** — confirm prompt is verbatim from session.jsonl line 1, source.jsx is verbatim, screenshots match the rendered artifact.
6. **Read end-to-end as a stranger.** Mentally simulate a developer who's never seen the project: do they understand what to install, what they're getting, and where to go for depth?

## Open items intentionally deferred

- **Launch video / GIF demos.** Separate spec — the marketing surface (zoomed prompt entry, tools running fast, Ask-to-fix flow, mobile artifact panel, audio + titles emphasizing local + no-payments + no-coding) needs its own brainstorm and probably a different toolchain (screen recorder, video editor, voiceover) than the docs work here. The README will gain a link to whatever ships from that spec.
- **CONTRIBUTING.md.** One-line note in the README is enough for v1.
- **API reference docs.** The tool surface is small enough to document in prose inside `docs/architecture.md`. Auto-generated reference would be overkill.
- **Internationalization.** English-only.
- **A docs site generator.** GitHub-rendered markdown is fine for v1.

# README + `docs/` Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stale 57-line README with an OSS-grade entry experience and a `docs/` tree (getting-started, architecture, artifacts, templates, memory). Build an examples gallery in `docs/artifacts.md` from 6 of the user's pinned sessions on disk.

**Architecture:** Seven self-contained doc tasks, one markdown file per task, one commit per task. No code changes, no tests, no runtime behavior changes. Each task references real source data on disk (session.jsonl files, artifact source.jsx, screenshots in `screenshots/`) so the docs are accurate and concrete rather than aspirational.

**Tech Stack:** Plain GitHub-flavored markdown. `<details>` blocks for collapsible artifact source. No site generator. Verification per task is a manual markdown-preview pass plus a link/anchor check.

---

## File Structure

| File | Role |
| --- | --- |
| `screenshots/<descriptive>.png` | Existing 9 PNGs renamed by content; 6 referenced from docs, 3 unused but retained |
| `README.md` | Hero + 60-second install + feature overview + screenshot grid (~150 lines) |
| `docs/getting-started.md` | Prerequisites, deep install, model-pull, MCP config, troubleshooting |
| `docs/architecture.md` | JSONL data model, multi-backend routing, tool surface, brief memory note |
| `docs/artifacts.md` | Concept + pipeline + 6-example gallery with inline source in `<details>` |
| `docs/templates.md` | The 3 built-in templates + how to add a new one |
| `docs/memory.md` | Auto-recall, save-check nudge, dedup, inspecting/clearing |

---

## Source data anchors

The implementer will reference these throughout. Map of pinned-session paths to gallery positions:

| # | Title | Session path (relative to `.data/`) | Has artifact? |
|---|---|---|---|
| 1 | Unseen Himachal Pradesh travel itinerary | `AAft3EmyUcIT/mnFciB7lhhOd/` | Yes (3 iteration dirs) |
| 2 | PowerGrid stock analysis dashboard | `AAft3EmyUcIT/xzVMWR82pL9X/` | Yes (3 iteration dirs) |
| 3 | Shakshuka recipe card | `AAft3EmyUcIT/3RnjiPCBOdHt/` | Yes (3 iteration dirs) |
| 4 | Model architectures explainer (no artifact) | `0TTK5mr4Iv84/LI31v3zIuzpb/` | No — pure prose |
| 5 | Latest news digest | `0TTK5mr4Iv84/SUghIBS32CEa/` | No — used `news` template |
| 6 | DeepSeek v4 interactive explainer | `hv_49QKaCPSu/ypsD-tuHhSjt/` | Yes (single canonical dir `deepseek-v4-explainer`) |

For each session: line 1 of `session.jsonl` is the meta record (assistantId, model, title); subsequent lines are `{type:"message", data:ChatMessage}`. The first user message is the prompt to quote verbatim. Artifact source lives at `<session>/artifacts/<id>/source.jsx`.

For sessions 1, 2, 3 (multiple artifact dirs from pre-dedup days), the implementer picks the **most complete** source.jsx — usually the one with the largest file size, or the latest by mtime. The dedup work landed *after* these sessions, hence the multi-dir state.

For session 6, the artifact id is the un-suffixed `deepseek-v4-explainer` — clean.

For sessions 4 and 5, there's no `artifacts/` dir. The implementer extracts the assistant's response message (or template-fill JSON for the news session) from `session.jsonl` directly.

---

## Conventions

- Branch: `experiment/pi-mono-llm-layer` (current). Stay on it.
- Working tree has unrelated uncommitted files (`.gitignore`, `next.config.ts`, untracked) — use **explicit `git add <file>`** per task. Do not include unrelated WIP.
- Commit messages: multi-line, what + why, with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer per CLAUDE.md.
- No code touched in this plan — no typecheck step. Verification is `cd /srv/work/sahayak && grep <text> README.md docs/*.md` for cross-references and a final visual pass via the user.

---

### Task 1: Inspect screenshots and rename to descriptive names

**Files:**
- Modify: 9 PNGs in `screenshots/` — rename in place.

The current names (`sahayak_1.png` … `sahayak_9.png`) carry no information. Rename each based on what it shows so the README and docs can reference them by intent. Unused PNGs stay but get descriptive names too — they may surface later.

- [ ] **Step 1: Inspect each PNG**

For each of the 9 PNGs, use the Read tool — it accepts image paths and renders them visually. Note what each shows. Write a one-line summary in a scratch file or inline comment. Examples of what each likely shows (model the user's UI knowledge): a chat with reasoning expanded, an artifact rendered in the panel, the memory page, settings, mobile bottom-sheet, theme variants.

```bash
ls /srv/work/sahayak/screenshots/*.png
```

Then, for each, use the Read tool with the absolute path. Summarize what you saw.

- [ ] **Step 2: Pick descriptive names**

Settle on names matching the content. Suggested vocabulary:
- `sahayak-chat-correspondence.png` (chat surface in default theme)
- `sahayak-chat-terminal.png` (terminal theme variant)
- `sahayak-artifact-recipe.png` (artifact panel showing a recipe card or similar)
- `sahayak-artifact-stock.png` (artifact panel with charts)
- `sahayak-memory-page.png`
- `sahayak-settings-page.png`
- `sahayak-mobile-bottom-sheet.png` (if any PNG shows the mobile artifact panel)
- `sahayak-tools-sidebar.png`
- `sahayak-thinking-expanded.png`

Match each PNG to whichever name fits. If two PNGs would share a name, qualify (`-v1`, `-detail`, etc.) or just drop one to a different name.

- [ ] **Step 3: Rename via `git mv`**

For each rename:

```bash
cd /srv/work/sahayak
git mv screenshots/sahayak_1.png screenshots/<new-name>.png
# repeat for each
```

Use `git mv` (not `mv`) so git tracks the rename. Keep working-tree clean.

- [ ] **Step 4: Verify**

```bash
cd /srv/work/sahayak && ls screenshots/*.png
```

Expected: 9 PNGs, all with descriptive names matching their content.

- [ ] **Step 5: Commit**

```bash
cd /srv/work/sahayak
git add screenshots/
git commit -m "$(cat <<'EOF'
screenshots: rename to descriptive names

The 9 PNGs in screenshots/ were named sahayak_1.png ...
sahayak_9.png with no indication of what they show. Rename
each based on content (chat / artifact / memory / settings /
mobile / themes) so the README and docs can reference them
by intent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Write the new README.md

**Files:**
- Modify: `README.md` (full replacement; existing 57-line version is replaced)

Target: ~150 lines. Seven sections in this order. Tone: factual, OSS-direct, no marketing fluff. Use the `screenshots/<descriptive>.png` names from Task 1.

- [ ] **Step 1: Read the current README to confirm what's there**

```bash
cat /srv/work/sahayak/README.md
```

(So you know what you're replacing — don't drag along stale content.)

- [ ] **Step 2: Write the new content**

Replace the entire content of `README.md` with the structure below. Fill in the prose; keep each section tight.

````markdown
# Sahayak

Local-first AI chat with interactive artifacts, cross-session memory, and three hand-designed themes. No cloud, no API keys, your data never leaves your machine.

![Chat surface](screenshots/<chat-screenshot>.png)

## Why Sahayak

- **Local-first.** Runs against [Ollama](https://ollama.com) or [llama.cpp](https://github.com/ggerganov/llama.cpp) on your machine. No keys, no quotas, no telemetry. Your sessions live in `.data/` as plain JSONL — back them up, grep them, move them between machines.
- **Multi-backend.** Same chat surface, swap engines per assistant: local llama.cpp (gguf files), local Ollama, or hosted Ollama Cloud (Kimi, MiniMax, GLM, etc.). Each assistant configures its own model and provider.
- **Interactive artifacts.** Models can emit real React components — Recharts dashboards, filterable tables, rendered SVG, maps — sandboxed in an iframe. The "**Build me a stock analysis dashboard with candlesticks**" workflow is an artifact, not a markdown screenshot of one.
- **MCP-aware.** Bring your own tool servers via the [Model Context Protocol](https://modelcontextprotocol.io). Configure once in `.config/mcp.json`, they appear in the assistant editor like any built-in tool.

## 60-second install

Prerequisites: Node 20+, Python 3.11+, [Ollama](https://ollama.com/download) running locally on port 11434.

```bash
git clone https://github.com/<your-fork>/sahayak && cd sahayak
npm install
npm run setup:python   # Creates .data/.venv with pandas/numpy/yfinance/...
```

Pull a tool-capable model and the embedding model used by memory:

```bash
ollama pull qwen3.5:9b           # any tool-capable model works
ollama pull nomic-embed-text     # for the memory subsystem
```

Run:

```bash
npm run dev    # http://localhost:9999
```

Detail (Windows / Apple Silicon / API keys / hosted Ollama Cloud / MCP) lives in [docs/getting-started.md](docs/getting-started.md).

## What's in the box

- **Chat surface** — streaming with reasoning, tool-result cards, regenerate, compaction, export to markdown.
- **[Artifacts](docs/artifacts.md)** — React components rendered in a sandboxed iframe; data flows from the session via `Sahayak.fetchData()`.
- **[Templates](docs/templates.md)** — pre-canned response shapes (news digest, itinerary, scorecard); the model fills in JSON, the renderer styles it.
- **[Memory](docs/memory.md)** — auto-recalled per turn, dedup at write, three types (fact / preference / procedural); inspectable via `cat .config/memory.jsonl | jq`.
- **Tool surface** — filesystem (read / write / search), shell with auto-prefixed Python venv, web search/fetch, Gmail (optional), MCP servers.
- **Themes** — three hand-designed styles × light/dark, switchable at runtime.
- **Single-user JSONL storage** — one file per session, inspectable with `cat | jq`. No DB.

## Screenshots

| | |
|---|---|
| ![Chat in correspondence theme](screenshots/<chat-correspondence>.png) | ![Artifact panel](screenshots/<artifact-stock>.png) |
| Default chat surface, "correspondence" theme. | Artifact panel rendering a stock dashboard. |
| ![Memory page](screenshots/<memory-page>.png) | ![Mobile bottom sheet](screenshots/<mobile-sheet>.png) |
| Memory page — filter by type, see what's been recalled. | Mobile artifact panel as a bottom sheet. |
| ![Terminal theme](screenshots/<terminal-theme>.png) | ![Settings](screenshots/<settings-page>.png) |
| "Terminal scholar" theme — mono everywhere. | Settings — TTL, memory health, Ollama key, MCP servers. |

## Stack

[Next.js 16](https://nextjs.org) App Router (Turbopack) · React 19 · TypeScript · [Tailwind 4](https://tailwindcss.com) (CSS-first tokens) · [`pi-agent-core`](https://github.com/mariozechner/pi-agent-core) for the LLM loop · `react-markdown` + [Shiki](https://shiki.style) for prose rendering · JSONL persistence.

See [docs/architecture.md](docs/architecture.md) for the data model and tool plumbing.

## License

MIT. PRs welcome — file an issue first for anything non-trivial so we can talk shape before you write code.
````

- [ ] **Step 3: Replace the screenshot placeholders with the actual filenames from Task 1**

Find each `<chat-screenshot>`, `<chat-correspondence>`, `<artifact-stock>`, `<memory-page>`, `<mobile-sheet>`, `<terminal-theme>`, `<settings-page>` placeholder. Replace with the actual descriptive filename from Task 1 (six are needed for the screenshot grid; the hero uses one of them — typically the chat-correspondence shot).

If a category doesn't have a matching screenshot (e.g. the existing 9 don't include a "settings page"), drop that row from the grid. The grid is 2×3 ideally, but 2×2 is acceptable.

- [ ] **Step 4: Verify links work**

```bash
cd /srv/work/sahayak && grep -E "\(docs/|\(screenshots/" README.md
```

Confirm each `docs/...` and `screenshots/...` path actually exists (the `docs/*.md` files don't yet — they land in subsequent tasks; the screenshot paths must already exist after Task 1).

- [ ] **Step 5: Commit**

```bash
cd /srv/work/sahayak
git add README.md
git commit -m "$(cat <<'EOF'
README: rewrite for OSS release

The previous 57-line tech-feature-list was stale (no
mention of artifacts, memory, .data/.venv, multi-backend),
contained outdated paths (data/sessions/... vs the actual
.data/<aid>/<sid>/session.jsonl), and never referenced any
of the 9 PNGs in screenshots/. New ~150-line entry
experience: hero with screenshot, "Why Sahayak" 4-bullet
differentiator, 60-second install, what's-in-the-box
overview with links into the new docs/ tree, 2x3 screenshot
grid, stack, license.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Write `docs/getting-started.md`

**Files:**
- Create: `docs/getting-started.md` (~120 lines)

Detailed install + troubleshooting — everything that didn't fit in the README's 60-second block.

- [ ] **Step 1: Write the file**

Create `docs/getting-started.md` with this structure:

````markdown
# Getting Started

Detailed install, configuration, and troubleshooting. The README's [60-second install](../README.md#60-second-install) is the happy path; this page covers per-platform notes, optional integrations, and common errors.

## Prerequisites

- **Node 20+** (we test against 20.18 and 22.x).
- **Python 3.11+** (for `.data/.venv` — used by `execute_command` when the model runs Python).
- **Ollama** running on `localhost:11434`. [Install instructions](https://ollama.com/download).
- A **tool-capable model** pulled. The chat loop only works against models that support function calling — `qwen3.5:9b`, `gemma4:26b`, `llama3.2`, `mistral-nemo` all qualify.
- The **embedding model** `nomic-embed-text` pulled. Required by the memory subsystem.

## Step-by-step install

### 1. Clone and install JS deps

```bash
git clone https://github.com/<your-fork>/sahayak
cd sahayak
npm install
```

### 2. Set up the Python venv

```bash
npm run setup:python
```

This script creates two virtualenvs:

- `python/.venv` — Sahayak's internal venv for officeparser + encrypted-PDF support.
- `.data/.venv` — the venv the model's `execute_command` and `pip_install` resolve to. Seeded with pandas, numpy, requests, yfinance, matplotlib.

Re-run `npm run setup:python` any time — it's idempotent. Adds new deps from `python/requirements.txt` and `.data/requirements.txt` if they've changed.

### 3. Pull a model + the embedding model

```bash
ollama pull qwen3.5:9b           # or your favorite tool-capable model
ollama pull nomic-embed-text     # for memory; ~270 MB
```

If you skip `nomic-embed-text`, memory writes succeed but recall returns empty. The settings page surfaces "pending" entries (saved but not indexed) and offers a Rebuild button you can use after pulling the model.

### 4. Run

```bash
npm run dev   # http://localhost:9999
```

First-run flow: visit `localhost:9999`, you'll be prompted to seed an assistant. Pick a name and your model.

## Optional configuration

### Hosted Ollama Cloud (Kimi / MiniMax / GLM / DeepSeek)

For an Ollama Cloud assistant: in the assistant editor, set provider to `ollama`, model to `kimi-k2.6:cloud` (or your chosen cloud model), and add an API key.

API key sources (Sahayak picks the first one that exists):

- `OLLAMA_API_KEY` env var
- `~/.openclaw/credentials/ollama.json` with `{ "api_key": "..." }`
- The Settings page → "Ollama key" field

Cloud models also enable hosted `web_search` / `web_fetch` tools.

### llama.cpp (gguf models)

If you'd rather run gguf files via llama.cpp directly (often faster on Apple Silicon and useful for quants Ollama doesn't ship):

1. Run `llama-server` against your gguf — e.g. `./llama-server -m models/qwen.gguf -c 32768 --host 127.0.0.1 --port 8080`.
2. In the assistant editor, set provider to `llama-cpp`, llamaUrl to `http://127.0.0.1:8080`, model to whatever name `llama-server` reports.

### Gmail tools (optional)

The `gmail_*` tools shell out to `/srv/work/agent-tools/gmail_agent.py` (an external script you supply). Provide the script + your OAuth credentials and the tools become available. If you don't, leave the tool group disabled per assistant.

### MCP servers

Add to `.config/mcp.json`:

```json
{
  "servers": {
    "<server-name>": {
      "command": "node",
      "args": ["path/to/mcp-server.js"]
    }
  }
}
```

The MCP discovery runs on startup; servers' tools surface in the assistant editor's tool picker.

## Where data lives

- `.config/` — global app config (assistants list, MCP servers, settings, memory, embeddings sidecar). Small, version it elsewhere if you want.
- `.data/` — per-session content (chats, uploads, artifacts) plus the project Python venv. Bigger; gitignored. Back up if you care about history.

To move between machines: copy both directories. JSONL is portable.

## Troubleshooting

**"connection refused on :11434"** — Ollama isn't running. `ollama serve` (or just open the Ollama app on macOS).

**"length" stop reason on long artifact prompts** — the model exceeded the 32k output token cap mid-fence. Either click Continue (the model emits a fresh artifact, losing the in-progress one — unfortunate but rare) or break the prompt into smaller asks.

**Memory writes succeed but recall always returns nothing** — `nomic-embed-text` isn't pulled. `ollama pull nomic-embed-text`, then visit Settings → Memory health → Rebuild index.

**`npm run setup:python` errors with "python3: command not found"** — install Python 3.11+ and ensure `python3` is on PATH. On Debian/Ubuntu also `apt install python3-venv`.

**Port 9999 in use** — change `package.json`'s `dev` and `start` scripts (or set `PORT=...`).

**Artifact panel shows "Cannot access iframe contentDocument"** — the artifact's source is invalid JSX. Click the source-toggle (`<>`) icon to see the raw code, or use Ask-to-fix.

**`pip_install` says "venv setup failed"** — usually `python3-venv` missing. Install your distro's venv package.
````

- [ ] **Step 2: Verify**

```bash
cd /srv/work/sahayak && grep -E "\.data/|\.config/|setup:python|nomic-embed-text" docs/getting-started.md | wc -l
```

Should return a non-zero count — the file mentions all the key paths and commands.

- [ ] **Step 3: Commit**

```bash
cd /srv/work/sahayak
git add docs/getting-started.md
git commit -m "$(cat <<'EOF'
docs: getting-started guide

Verbose install + configuration reference for the README's
60-second block. Covers per-platform Ollama notes, the
.data/.venv setup, the embedding model requirement, hosted
Ollama Cloud + llama.cpp + Gmail + MCP configuration paths,
data layout, and a troubleshooting section for the common
errors (Ollama down, length truncation, empty recall, venv
setup failures, port conflicts).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Write `docs/architecture.md`

**Files:**
- Create: `docs/architecture.md` (~80 lines)

High-level architecture — JSONL data model, multi-backend routing, tool surface, brief memory note. Reader who's deciding whether to fork / hack on Sahayak.

- [ ] **Step 1: Write the file**

Create `docs/architecture.md` with this structure:

````markdown
# Architecture

A high-level tour of how Sahayak is wired. For deep dives into individual subsystems, see the linked pages.

## Big picture

```
Browser (Next.js client)
  │
  ▼  /api/chat  (SSE stream)
Next.js route → pi-agent-core → Ollama / llama.cpp
                     │
                     ├── Tool calls (filesystem, shell, web, MCP, ...)
                     ├── Memory bridge (auto-recall per turn)
                     └── Artifact pipeline (artifact_create + iframe runtime)
```

The chat route streams Server-Sent Events back to the browser. Each event is one of: `content` (assistant text), `thinking` (collapsed reasoning), `tool_call`, `tool_result`, `assistant_message` (turn end), `done_turn`, `error`.

The browser is responsible for **persistence** — on each `assistant_message` event it `PATCH`es the session JSONL on disk. The chat route itself is stateless: it composes the prompt, runs the loop, streams back, and forgets.

## Data model — JSONL, not a database

All persistent state lives under two directories:

- `.config/` — global, small, stable.
  - `assistants.json` — assistant list (per-assistant model, provider, system prompt, tool set, etc.).
  - `mcp.json` — MCP server config.
  - `settings.json` — user prefs (TTS, cleanup TTL, Ollama key).
  - `memory.jsonl` — append-only memory log.
  - `memory.vec.jsonl` — vector sidecar (one line per memory id).
  - `memory.meta.json` — last-rebuild timestamp.

- `.data/` — per-session content, gitignored.
  - `<assistantId>/<sessionId>/session.jsonl` — line 1 is meta, rest are messages.
  - `<assistantId>/<sessionId>/uploads/` — content-addressed files referenced from messages.
  - `<assistantId>/<sessionId>/artifacts/<artifactId>/` — `meta.json`, `source.jsx`, `files/` (data the artifact loads via `Sahayak.fetchData()`).
  - `.venv/` — project Python venv (Task 5 of the artifact-mode reliability spec).
  - `requirements.txt` — packages installed via `pip_install`.

To delete a session: `rm -rf .data/<aid>/<sid>/`. Everything the chat touched goes with it. No dedup across sessions, no cascade, no pinning at the artifact level — the session is the unit.

## Multi-backend routing

The chat route picks a backend per assistant:

- `provider: "ollama"` — talks to `OLLAMA_URL` (`http://localhost:11434` by default), via Ollama's OpenAI-compatible `/v1` endpoint.
- `provider: "llama-cpp"` — talks to a llama.cpp `llama-server` instance at `assistant.llamaUrl` (e.g. `http://127.0.0.1:8080`), via the same OpenAI-compat `/v1` shape.

Both routes go through `pi-agent-core`, which does the tool-calling loop. Sahayak supplies the `Model<"openai-completions">` config (output token cap, context window, capability flags) via [`src/lib/piAdapters.ts`](../src/lib/piAdapters.ts).

The same chat surface, tools, memory, and artifact pipeline work identically across backends. Switching is a per-assistant config change.

## Tool surface

Tools are `ToolSpec`s registered in [`src/lib/tools/index.ts`](../src/lib/tools/index.ts). Two visibility classes:

- **User-facing tools** in `ALL_TOOLS` — surfaced in the assistant editor's tool picker. HITL approval gate by default. Examples: `read_file`, `execute_command`, `pip_install`, `web_search`, `artifact_create`, `artifact_write_file`, Gmail tools.
- **Implicit tools** in `IMPLICIT_TOOLS` — always available, never shown in the picker, never HITL-gated. Used for memory: `remember`, `recall_memory`, `list_memories`. The model can save and recall freely; the user sees the tool calls in the chat.

MCP-server tools are wrapped into `ToolSpec`s at startup so the chat loop sees them uniformly.

The shell tool (`execute_command`) auto-prefixes leading `python` / `python3` / `pip` / `pip3` tokens to `.data/.venv/bin/...` so the model can't accidentally hit system Python. See [docs/getting-started.md](getting-started.md) for the full setup.

## Memory subsystem (brief)

Three types: `fact`, `preference`, `procedural`. Facts and preferences are always-injected into every system prompt. Procedurals surface via per-turn auto-recall (cosine similarity over `nomic-embed-text` embeddings, top-3 over a 0.7 threshold). Server-side dedup blocks duplicate writes. Failed embeddings retry on subsequent chat turns.

Full subsystem details: [docs/memory.md](memory.md).

## Artifact pipeline (brief)

`artifact_create` reserves a workspace (or returns an existing one if the slug-stem matches) and gives the model a `files_path`. The model writes data files via `artifact_write_file`. The model emits a fenced `react-artifact` block with `// id: <same id>`. The renderer mounts the JSX inside an iframe at `/artifact-runtime.html`; the iframe loads data via `Sahayak.fetchData('<filename>')` which `postMessage`s back to the parent for `/api/artifact-data/...` lookups.

External HTTPS images (Unsplash, Wikimedia, official CDNs) are allowed and encouraged. Scripts, stylesheets, custom fonts, and `fetch()` to other origins are off-policy by prompt convention (no CSP today; the prompt is the gate).

Full pipeline + 6-example gallery: [docs/artifacts.md](artifacts.md).

## Themes

Three hand-designed CSS-token sets: `correspondence` (warm paper), `terminal` (mono everywhere), `editorial` (magazine cream). Each × light/dark. Switched at runtime by swapping a `theme-*` class on `<html>`. Tokens in [`src/app/globals.css`](../src/app/globals.css); `next-themes` handles dark mode.
````

- [ ] **Step 2: Verify**

```bash
cd /srv/work/sahayak && grep -E "src/lib/|src/app/" docs/architecture.md | wc -l
```

Should return ≥ 4 — internal source links exist.

- [ ] **Step 3: Commit**

```bash
cd /srv/work/sahayak
git add docs/architecture.md
git commit -m "$(cat <<'EOF'
docs: architecture overview

High-level tour of the system: SSE chat route through
pi-agent-core to Ollama or llama.cpp; JSONL data model
with .config/ for global state and .data/ for per-session
content; multi-backend routing via per-assistant provider
config; tool surface (user-facing vs implicit memory tools,
MCP wrapping); brief notes on memory and artifacts that
defer to their dedicated docs pages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Write `docs/artifacts.md` — concept + 6-example gallery

**Files:**
- Create: `docs/artifacts.md` (~250 lines — biggest task in this plan)

The artifact pipeline + a real examples gallery from the user's pinned sessions. Each example is a self-contained section with prompt, screenshot, commentary, collapsed source.

- [ ] **Step 1: Pull the prompts and source from each session**

For each of the 6 sessions, extract:

```bash
# 1. Himachal
SESS=/srv/work/sahayak/.data/AAft3EmyUcIT/mnFciB7lhhOd
head -1 $SESS/session.jsonl | jq -r '.title'
# First user message:
jq -c 'select(.type == "message" and .data.role == "user") | .data.content' $SESS/session.jsonl | head -1
ls $SESS/artifacts/
# Pick the largest source.jsx among the iteration dirs:
wc -l $SESS/artifacts/*/source.jsx | sort -rn | head -3

# Repeat for each:
# 2. PowerGrid: /srv/work/sahayak/.data/AAft3EmyUcIT/xzVMWR82pL9X
# 3. Shakshuka: /srv/work/sahayak/.data/AAft3EmyUcIT/3RnjiPCBOdHt
# 4. Model architectures: /srv/work/sahayak/.data/0TTK5mr4Iv84/LI31v3zIuzpb (no artifacts dir — extract the assistant's response from session.jsonl)
# 5. Latest news: /srv/work/sahayak/.data/0TTK5mr4Iv84/SUghIBS32CEa (no artifacts dir — extract the template-fill JSON from session.jsonl)
# 6. DeepSeek v4: /srv/work/sahayak/.data/hv_49QKaCPSu/ypsD-tuHhSjt (single canonical artifact dir: deepseek-v4-explainer)
```

For sessions 1, 2, 3 (multi-iteration), pick the **most-complete** source.jsx — usually the largest by line count, or whichever has the most polished JSX (visual judgement).

For session 4 (model architectures), open `session.jsonl`, find the assistant's response message, extract a representative ~30-50 line excerpt of the markdown.

For session 5 (latest news), find the template fence the model emitted (look for ` ```template:news ` or similar). Extract the JSON.

For session 6 (DeepSeek v4), the artifact id is `deepseek-v4-explainer` (no nanoid suffix — clean).

- [ ] **Step 2: Pick a screenshot for each example (if available)**

Cross-reference the renamed PNGs from Task 1. If any of the 9 PNGs visibly shows one of the 6 examples (likely candidates: a chart-rendering shot for PowerGrid, a recipe-card shot for Shakshuka), assign it. If the PNG roster doesn't have a shot for a particular example, skip the screenshot for that one and use a generic caption like "Rendered output (screenshot pending)" — don't fabricate.

- [ ] **Step 3: Write the file**

Create `docs/artifacts.md` with this structure:

````markdown
# Artifacts

Real React components rendered in a sandboxed iframe — not just markdown screenshots of components. The model writes JSX, the runtime compiles it, the panel mounts it.

## What's an artifact?

An artifact is a self-contained React component the model emits inside a fenced `react-artifact` block. The renderer compiles the JSX with Babel Standalone, mounts a single `function App()` in an iframe at `/artifact-runtime.html`, and gives the artifact access to two pre-loaded globals — `Recharts` (for charts) and `Papa` (PapaParse, for CSV) — plus a small data bridge `Sahayak.fetchData(filename)` that pulls files the model wrote during the same turn.

Artifacts are **distinct from templates**:

- **Templates** are pre-styled JSON shapes for repeatable formats (news digests, itineraries, scorecards). The model emits structured JSON; a hand-written React renderer styles it. See [docs/templates.md](templates.md).
- **Artifacts** are general-purpose React. The model writes whatever JSX it wants; the runtime compiles and mounts it. Use these when no template fits — interactive dashboards, custom layouts, one-off visualizations.

Rule of thumb: if you'd want the same shape again next week, write a template. If it's bespoke, ask for an artifact.

## The data pipeline

For artifacts that need data (charts from a CSV, content from a Python script):

1. **`artifact_create({ id?, title })`** — reserves a workspace. Returns the artifact id you'll use in the fence. **Call ONCE per chat session.** Iterations re-emit the same id rather than calling `artifact_create` again.
2. **`execute_command "python ..."`** — fetch / compute / generate data. Output goes to stdout.
3. **`artifact_write_file({ id, filename, content })`** — write the stdout (or arbitrary content) into the artifact's `files/` dir.
4. **Emit the fenced block** — `// title:` and `// id:` comments at the top. Inside `App()`, load the file with `await Sahayak.fetchData('data.csv')`. Parse with `Papa.parse(...)` if it's CSV. Render with Recharts or hand-rolled SVG.

The full prompt the model sees is in [`src/lib/store.ts`](../src/lib/store.ts) (`REACT_ARTIFACT_INSTRUCTIONS`). Two notable rules:

- **External HTTPS images are allowed.** Use Unsplash, Wikimedia, or the user's URLs. Set `width` / `height`, use `loading="lazy"`, `objectFit: "cover"`. See the prompt for the full hygiene checklist.
- **Other external resources** (scripts, stylesheets, custom fonts, `fetch()` to other origins) are off-policy. App data goes through `Sahayak.fetchData`.

## Examples

Six real artifacts pulled from pinned chat sessions. Each shows a different shape (multi-panel finance, recipe card, travel itinerary, prose-only mode, template, interactive explainer) and a different backend (llama.cpp local / Ollama local / Ollama cloud).

### 1. Unseen Himachal Pradesh travel itinerary

**Assistant:** QWEN3.6-27B-LOCAL-LLAMA · **Backend:** llama.cpp (local gguf)
**Tools used:** `web_search`, `artifact_create`, `artifact_write_file`

> **Prompt:**
> <verbatim user prompt — extract from session.jsonl line 2 or 3>

<screenshot if available — else skip the image line>

Long-form travel itinerary covering off-the-beaten-path Himachal destinations. Showcases composition: itinerary cards with hero images (post-Unsplash-allowlist), day-by-day breakdown, budget bar, and a route map sketch. Demonstrates how the model can include external HTTPS images and structure complex content within a single `function App()`.

<details>
<summary>Artifact source (~<line count> lines)</summary>

```jsx
<verbatim from artifacts/<chosen-id>/source.jsx>
```

</details>

### 2. PowerGrid stock analysis dashboard

**Assistant:** QWEN3.6-27B-LOCAL-LLAMA · **Backend:** llama.cpp (local gguf)
**Tools used:** `pip_install`, `execute_command` (Python via `.data/.venv`), `artifact_create`, `artifact_write_file`

> **Prompt:**
> <verbatim>

<screenshot — likely a candidate from the renamed set>

Multi-panel finance dashboard with candlestick chart (Recharts), moving averages, RSI indicator, news correlation panel, and a buy/hold/sell summary card. Showcases the full Python pipeline: model installs `yfinance`, runs a script to fetch 60-day OHLCV, writes it as `data.csv`, the artifact loads it via `Sahayak.fetchData`. The largest of the gallery — demonstrates that complex multi-component artifacts can be a single React tree.

<details>
<summary>Artifact source (~<line count> lines)</summary>

```jsx
<verbatim>
```

</details>

### 3. Shakshuka recipe card

**Assistant:** QWEN3.6-27B-LOCAL-LLAMA · **Backend:** llama.cpp (local gguf)
**Tools used:** `artifact_create`

> **Prompt:** "make me a recipe card for shakshuka with a hero image and an ingredient list. one cohesive react component."

<screenshot if available>

Compact recipe card: hero image from Unsplash, ingredient list with quantity styling, step-by-step instructions, prep/cook time pills. Demonstrates the external-images flow at its simplest — one image, well-sized (`w=800&q=80&auto=format`), `loading="lazy"`, real `alt` text. No data file, no Python — just a self-contained component.

<details>
<summary>Artifact source (~<line count> lines)</summary>

```jsx
<verbatim>
```

</details>

### 4. Model architectures explainer (no artifact)

**Assistant:** QWEN3.6-35B-Local · **Backend:** Ollama (local)
**Tools used:** `web_search`, `web_fetch`

> **Prompt:**
> <verbatim>

Pure prose mode — no `react-artifact` fence emitted. The model wrote a long-form explanation with markdown headings, comparison tables, and code excerpts of attention mechanisms. Demonstrates that artifacts are **opt-in** (toggled via the Sparkles button); when not toggled, you get rich markdown, syntax-highlighted code via Shiki, and tables that collapse to cards on mobile. Useful when the answer is *informational* rather than *interactive*.

<details>
<summary>Excerpt from the assistant response (~30 lines)</summary>

```markdown
<excerpt extracted from session.jsonl>
```

</details>

### 5. Latest news digest (template)

**Assistant:** QWEN3.6-35B-Local · **Backend:** Ollama (local)
**Tools used:** `web_search`, `web_fetch`, the `news` template

> **Prompt:**
> <verbatim>

The user's preferred news format — 6 categorical sections (AI/LLM, GeoPolitics, War, Markets, Sports, Economics) with emoji + tables, fed by `web_search`. The model emits a fenced ` ```template:news ` block with structured JSON; the renderer in [`src/lib/templates/news.tsx`](../src/lib/templates/news.tsx) styles it. Demonstrates that templates give consistent visual treatment for repeatable formats without asking the model to write JSX every time. See [docs/templates.md](templates.md) for the template system.

<details>
<summary>Template-fill JSON excerpt (~30 lines)</summary>

```json
<excerpt extracted from session.jsonl>
```

</details>

### 6. DeepSeek v4 interactive explainer

**Assistant:** MiniMax · **Backend:** Ollama Cloud (`minimax-m2.7:cloud`)
**Tools used:** `web_search`, `web_fetch`, `artifact_create`, `artifact_write_file`

> **Prompt:**
> <verbatim — note this prompt mentioned "click through" so it's deliberately interactive>

Click-through interactive explainer of DeepSeek v4's architecture — tabs / accordions for different model components, hover effects, expandable diagrams. Showcases the **Ollama Cloud** backend (the MiniMax model is hosted, not local) producing the same artifact shape as the local-llama.cpp examples above. Same chat surface, same artifact pipeline — only the upstream model server differs.

<details>
<summary>Artifact source (~<line count> lines)</summary>

```jsx
<verbatim>
```

</details>

## Adding your own artifact

Toggle artifact mode (the Sparkles button in the composer; on mobile, the `+` menu's "Artifact mode" item). Describe what you want. The model handles the pipeline above. Iterations on the same artifact reuse the same id — don't create a new one when you want to refine.

## Limitations

- **Single React tree per artifact.** Each fence mounts one `function App()`. Multi-page artifacts aren't a thing — model composes them as routed sub-components inside one App.
- **No external scripts / fonts / cross-origin fetch.** Prompt-policy only (no CSP today). Bring data in via `Sahayak.fetchData()` and assets via HTTPS images per the prompt's allowlist.
- **Babel Standalone compiles JSX in-browser.** Adds ~500 KB to the iframe but lets the model emit JSX-flavored React without a build step. Production-grade artifacts that warrant precompilation aren't in scope.
- **No TypeScript in artifacts.** The compiler accepts JSX but not TS syntax. The model writes plain JS + JSX.
````

- [ ] **Step 4: Replace each `<verbatim>` placeholder**

Open each session's `session.jsonl` and `source.jsx`, copy the actual content. Verify the prompts are exactly as the user wrote them (don't paraphrase). Verify the JSX compiles by eye-balling the structure (matched braces, valid imports).

For sessions 1-3 (multi-iteration), pick whichever iteration's source.jsx looks most polished. The most-recent or largest is usually the right pick. If two look equally good, pick by `meta.json`'s timestamp.

- [ ] **Step 5: Replace each `<line count>` placeholder**

For each example with a source.jsx, count its lines and put the number in the `<details>` summary. Helps the reader decide whether to expand it.

- [ ] **Step 6: Replace each `<screenshot>` placeholder**

For examples that have a matching renamed screenshot from Task 1, add the markdown image. For examples that don't, drop the screenshot line — don't fabricate a path.

- [ ] **Step 7: Verify**

```bash
cd /srv/work/sahayak && wc -l docs/artifacts.md
```

Expected: roughly 200-300 lines (depending on artifact source sizes — long sources balloon the file).

```bash
cd /srv/work/sahayak && grep -c "^### " docs/artifacts.md
```

Expected: 6 (the six examples) + maybe a 7th if you titled "Adding your own" with `###`.

- [ ] **Step 8: Commit**

```bash
cd /srv/work/sahayak
git add docs/artifacts.md
git commit -m "$(cat <<'EOF'
docs: artifacts page with 6-example gallery

Concept (artifacts vs templates), the data pipeline
(artifact_create + artifact_write_file + Sahayak.fetchData),
and a real examples gallery pulled from pinned chat
sessions. Six examples covering all three backends:
Unseen Himachal itinerary (llama.cpp), PowerGrid stock
dashboard (llama.cpp + Python venv), Shakshuka recipe card
with external image (llama.cpp), model architectures
explainer in pure prose (Ollama local), latest news with
the news template (Ollama local), and a DeepSeek v4
interactive explainer (Ollama Cloud / MiniMax).

Source code for each is inlined inside <details> blocks
so the page stays scannable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Write `docs/templates.md`

**Files:**
- Create: `docs/templates.md` (~80 lines)

The 3 built-in templates + how to add a new one. Brief — the source files in `src/lib/templates/` carry most of the detail.

- [ ] **Step 1: Read the template files for accuracy**

```bash
ls /srv/work/sahayak/src/lib/templates/
cat /srv/work/sahayak/src/lib/templates/index.ts
head -30 /srv/work/sahayak/src/lib/templates/news.tsx
head -30 /srv/work/sahayak/src/lib/templates/itinerary.tsx
head -30 /srv/work/sahayak/src/lib/templates/scorecard.tsx
```

Note each template's name, description, JSON shape (the type signature at the top of each .tsx file).

- [ ] **Step 2: Write the file**

Create `docs/templates.md` with this structure:

````markdown
# Templates

Pre-styled JSON shapes for repeatable formats. Distinct from [artifacts](artifacts.md): templates lock in a layout the renderer styles consistently; artifacts are bespoke React the model writes from scratch.

## When to use a template vs an artifact

- **Template** for a shape you'd want again — news digest, itinerary, scorecard. Consistent visual treatment, no JSX from the model. Built-ins are the only ones today; adding a new template means writing a renderer (small TSX file).
- **Artifact** for one-offs and interactive components — dashboards, custom visualizations, click-through explainers. Model writes JSX; the runtime compiles and mounts.

A scorecard for "compare these 5 phones" is a template; a live filterable table of those phones is an artifact.

## How a template works

1. The user selects a template from the composer (template picker icon — appears when at least one template exists in the session).
2. The selected template's name + JSON schema gets appended to the system prompt for that turn only.
3. The model emits a fenced block: ` ```template:<id>\n{...json...}\n``` `.
4. The renderer in [`src/lib/templates/<id>.tsx`](../src/lib/templates/) parses the JSON and styles it.
5. Fall-through: if the model fails to emit a valid template fence (or the JSON doesn't match the schema), the renderer surfaces a parse error inline; the user can ask for a retry.

## Built-in templates

### `news` — categorical digest

Source: [`src/lib/templates/news.tsx`](../src/lib/templates/news.tsx).

The user's news shape: a list of category sections, each with an emoji, heading, optional bullets, optional table rows. Designed for "give me the latest news on X" prompts where the user wants consistent grouping (AI / Markets / Sports / etc.).

JSON shape:

```ts
{
  generated_at: string;          // ISO timestamp
  sections: Array<{
    emoji: string;               // single emoji
    title: string;
    items: Array<{
      headline: string;
      body?: string;             // markdown OK
      source?: { title: string; url: string };
    }>;
  }>;
}
```

### `itinerary` — day-by-day travel plan

Source: [`src/lib/templates/itinerary.tsx`](../src/lib/templates/itinerary.tsx).

A trip itinerary with days, activities, timing, and budget. Designed for travel-planning prompts where consistent rendering matters across "Italy", "Japan", "weekend in Delhi".

JSON shape:

```ts
{
  destination: string;
  duration_days: number;
  budget_range?: { min: number; max: number; currency: string };
  days: Array<{
    day: number;
    title: string;
    activities: Array<{
      time?: string;
      title: string;
      description?: string;
      cost_estimate?: number;
    }>;
    notes?: string;
  }>;
}
```

### `scorecard` — feature comparison grid

Source: [`src/lib/templates/scorecard.tsx`](../src/lib/templates/scorecard.tsx).

A side-by-side feature comparison. Rows are features, columns are options. Designed for "compare X / Y / Z on A / B / C" prompts.

JSON shape:

```ts
{
  title: string;
  options: Array<{ name: string; subtitle?: string }>;
  features: Array<{
    name: string;
    values: string[];          // one per option, same order
  }>;
  recommendation?: { winner: string; reasoning: string };
}
```

## Adding your own template

Three steps:

1. **Write a renderer.** Create `src/lib/templates/<id>.tsx` exporting a `function MyTemplate({ data }: { data: MyShape }) { ... }`. Style it however you want.
2. **Register it.** Add a `<id>` entry to [`src/lib/templates/index.ts`](../src/lib/templates/index.ts) with `id`, `name`, `description`, `icon` (an emoji), and the `Component` you wrote.
3. **Add the schema** to `TEMPLATE_META` so the system prompt knows what JSON shape to ask the model for.

The composer picker auto-discovers all entries in `index.ts`; no further wiring needed.

For a working example, copy `news.tsx` and adapt — it's the simplest of the three.
````

- [ ] **Step 3: Verify the JSON shapes against the actual TSX files**

Open each of the three template TSX files and confirm the JSON shape you documented matches the `type` declaration at the top. If a field name differs (`headline` vs `title`, etc.), correct the doc to match the code, not the other way around.

- [ ] **Step 4: Commit**

```bash
cd /srv/work/sahayak
git add docs/templates.md
git commit -m "$(cat <<'EOF'
docs: templates page

Concept (template vs artifact rule of thumb), how the
fenced template:<id> JSON gets parsed and styled, the
three built-ins (news / itinerary / scorecard) with their
JSON shapes pulled from the actual type declarations in
src/lib/templates/*.tsx, and a 3-step recipe for adding a
new template.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Write `docs/memory.md`

**Files:**
- Create: `docs/memory.md` (~80 lines)

Tight summary of the memory subsystem. The detail lives in code; this page tells the user enough to use and inspect it.

- [ ] **Step 1: Write the file**

Create `docs/memory.md` with this structure:

````markdown
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
````

- [ ] **Step 2: Verify**

```bash
cd /srv/work/sahayak && grep -E "memory.jsonl|nomic-embed-text|/memory" docs/memory.md | wc -l
```

Should return ≥ 4.

- [ ] **Step 3: Commit**

```bash
cd /srv/work/sahayak
git add docs/memory.md
git commit -m "$(cat <<'EOF'
docs: memory subsystem page

Three types (fact / preference / procedural), the two
surfacing paths (always-injected block for fact+pref, auto-
recall for procedurals via cosine threshold), server-side
guardrails (dedup at 0.92, vectorPending retry, soft cap),
inspecting via the Memory page or jq, and a small FAQ
covering per-assistant scoping (global), editing,
disabling, and the local-only embedding model.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final cross-check

After all 7 tasks land, run a quick consistency check:

```bash
cd /srv/work/sahayak

# All docs/ links from README resolve
grep -oE '\(docs/[a-z-]+\.md\)' README.md | tr -d '()' | sort -u | while read p; do test -f "$p" && echo "✓ $p" || echo "✗ MISSING: $p"; done

# All screenshots/ references from README + docs/ resolve
grep -hroE 'screenshots/[a-zA-Z0-9_-]+\.png' README.md docs/ | sort -u | while read p; do test -f "$p" && echo "✓ $p" || echo "✗ MISSING: $p"; done

# All inter-doc links resolve (./docs/*.md → other docs/*.md)
grep -hoE '\([a-z-]+\.md[#a-zA-Z0-9-]*\)' docs/*.md | tr -d '()' | sort -u | while read p; do
  base="${p%%#*}"
  test -f "docs/$base" && echo "✓ docs/$base" || echo "✗ MISSING: docs/$base"
done
```

Expected: every line starts with `✓`. Any `✗` is a typo / missing file to fix.

Then a visual pass — open `README.md` in GitHub's preview (push the branch, browse the file) and confirm it renders cleanly: hero image loads, screenshot grid is 2×3 or 2×2, all `[link]` links navigate, the headline reads well at the top of the page.

---

## Self-review

**1. Spec coverage**

| Spec section | Implemented in | Status |
| --- | --- | --- |
| README hero + 60s install + features + screenshots + license | Task 2 | ✅ |
| `docs/getting-started.md` deep install + troubleshooting | Task 3 | ✅ |
| `docs/architecture.md` JSONL + multi-backend + tools | Task 4 | ✅ |
| `docs/artifacts.md` concept + pipeline + 6-example gallery | Task 5 | ✅ |
| `docs/templates.md` 3 built-ins + how to add | Task 6 | ✅ |
| `docs/memory.md` types + recall + dedup + inspect | Task 7 | ✅ |
| Screenshot rename to descriptive names | Task 1 | ✅ |
| 6 examples drawn from real pinned sessions | Task 5 (with explicit session paths in the source-data table) | ✅ |
| Out of scope: launch video, examples/ dir, docs site generator | Honored — no tasks attempt them | ✅ |

**2. Placeholder scan:** None of the "TBD / TODO / fill in details" red-flag patterns. The `<verbatim>` and `<line count>` placeholders in Task 5 are explicit "implementer extracts from session.jsonl" instructions, not unfilled spec gaps — they're the same kind of "implementer reads source and writes the docs" that's expected throughout.

**3. Type consistency:** No code touched. The doc files reference each other consistently (always relative paths inside `docs/` to other `docs/<page>.md`; README links use `docs/<page>.md`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-01-readme-and-docs.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for the 7-task sweep where each file has clear scope and judgment-calls (which screenshot for which name, which artifact source iteration is "best").

**2. Inline Execution** — I run all 7 tasks in this session with checkpoints. Faster end-to-end but no review pass per task.

Which approach?

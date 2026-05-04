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

The chat route ([`src/app/api/chat/route.ts`](../src/app/api/chat/route.ts)) streams Server-Sent Events back to the browser. Each event is one of: `content` (assistant text), `thinking` (collapsed reasoning), `tool_call`, `tool_result`, `assistant_message` (turn end), `done_turn`, `error`.

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
  - `.venv/` — project Python venv (used by `execute_command` and `pip_install`).
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

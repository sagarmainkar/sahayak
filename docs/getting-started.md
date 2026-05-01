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

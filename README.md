# Sahayak

Local-first AI chat client for [Ollama](https://ollama.com). Built with Next.js 16, React 19, TypeScript, Tailwind 4.

## Features

- **Assistants** — named personas with per-assistant system prompt, model, tool set, thinking effort
- **Streaming chat** with tool-calling loop, reasoning (collapsed marginalia), tool-result cards (structured per tool)
- **Context gauge** — live prompt-token bar, coloured by fill
- **Compaction** — manual or auto summary of older turns
- **Markdown** with Shiki syntax-highlighted code blocks, custom serif prose, tables, blockquotes
- **Link previews** via `/api/unfurl` (OG metadata) — standalone URLs in replies unfurl to rich cards
- **Images** — drag, paste, or pick; stored content-addressed in `data/uploads/`, tiny refs in JSONL
- **Export** — per-session markdown dump with thinking, tool-calls, and results
- **Regenerate** — ↺ on the last user message
- **Themes** — three hand-designed styles (Correspondence / Terminal Scholar / Editorial), plus light/dark
- **JSONL storage** — one file per session, inspectable with `cat | jq`

## Stack

- [Ollama](https://ollama.com) — local LLM runtime, served at `http://localhost:11434`
- Next.js 16 App Router, Turbopack
- Tailwind 4 (CSS-first tokens), `next-themes`, `lucide-react`
- `react-markdown` + `remark-gfm`, Shiki for syntax highlighting
- File-based persistence: JSON for assistants, JSONL for sessions, content-addressed uploads

## Local tools exposed to the model

- Filesystem: `read_file`, `write_file`, `list_directory`, `search_files`, `get_file_info`, `path_exists`
- Shell: `execute_command`
- Web: `web_search`, `web_fetch` (via Ollama hosted search API)
- Gmail: wraps `gmail_agent.py` (external)

## Running

```bash
npm install
npm run dev        # http://localhost:9999
```

Requires Ollama running locally with at least one tool-capable model pulled (e.g. `qwen3.5:9b`, `gemma4:26b`). An optional `OLLAMA_API_KEY` enables web search/fetch; Sahayak auto-picks it up from `~/.openclaw/credentials/ollama.json` if present.

## Data layout

```
data/
  assistants.json
  sessions/<assistantId>/<sessionId>.jsonl
  uploads/<sha256>.<ext>
```

All gitignored.

## License

MIT.

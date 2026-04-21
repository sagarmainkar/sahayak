# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

Stack is **Next.js 16 + React 19 + Tailwind 4**. APIs, conventions, and file structure differ from older versions that dominate training data. Before writing Next/React/Tailwind code, skim the relevant guide in [node_modules/next/dist/docs/](node_modules/next/dist/docs/) (`01-app/`, `02-pages/`, `03-architecture/`) and heed deprecation notices in-file.

Things that routinely trip up older intuition:
- Route handler / page `params` and `searchParams` are `Promise<...>` — `await` them. See [src/app/api/assistants/[id]/route.ts](src/app/api/assistants/[id]/route.ts).
- Tailwind 4 is CSS-first (tokens live in [src/app/globals.css](src/app/globals.css)); **no `tailwind.config.{js,ts}`, no `@tailwindcss/typography`**. Prose styling is hand-rolled.
- App Router only. `next/font/google` for fonts (see [src/app/layout.tsx](src/app/layout.tsx)).
<!-- END:nextjs-agent-rules -->

## Commands

```bash
npm install
npm run dev      # http://localhost:9999 (Turbopack)
npm run build
npm run start    # port 9999
npm run lint     # eslint, flat config (eslint.config.mjs)
```

There is no test suite. Verify UI changes by running `npm run dev` and exercising the feature in a browser.

## Prerequisites the app assumes at runtime

- **Ollama** on `http://localhost:11434` with a tool-capable model pulled. Override with `OLLAMA_URL`.
- Optional `OLLAMA_API_KEY` (for hosted `web_search` / `web_fetch`). Falls back to reading `~/.openclaw/credentials/ollama.json` → `api_key`.
- The `gmail_*` tools shell out to `/srv/work/agent-tools/gmail_agent.py`; the `execute_command` tool uses whatever `python3` is on PATH (Sagar's box points it at a venv with `yfinance`/`pandas`).

## Architecture

### Data contract — JSONL, not a database

All user data lives under `data/` (gitignored) and is read/written directly by API routes. **Do not reach for SQLite or an ORM** — the single-user, file-based contract is deliberate.

```
data/
  assistants.json                            # array<Assistant>
  sessions/<assistantId>/<sessionId>.jsonl   # line 1 = meta record, rest = {type:"message", data:ChatMessage}
  uploads/<sha256>.<ext>                     # content-addressed images, referenced by filename from messages
  artifacts/
    _by_hash.json                            # source-SHA256 → artifact id (dedup)
    <id>/ meta.json, source.jsx, files/      # per-artifact dir; files/ holds data the artifact loads
```

Hot paths in [src/lib/store.ts](src/lib/store.ts):
- `listSessions()` loads the whole JSONL per file. For analytics dashboards use `listSessionMetas()` — it reads only the first line of each file.
- Session ids are globally unique; `getSession`/`updateSession`/`deleteSession` scan assistant dirs to find them.

### Chat pipeline ([src/app/api/chat/route.ts](src/app/api/chat/route.ts))

`POST /api/chat` proxies to Ollama `/api/chat` and streams SSE events back (`content`, `thinking`, `tool_call`, `tool_result`, `assistant_message`, `done_turn`, `end`, `error`). The route runs a **tool-calling loop** up to `maxToolTurns` (default 8): it reads tool calls from Ollama's stream, executes the matching handler from [src/lib/tools/index.ts](src/lib/tools/index.ts), appends a `tool`-role message, and re-streams. Tool output sent to the model is truncated at 4000 chars; the full JSON is sent to the client for UI/persistence.

Client-side persistence is the client's job: [src/components/Chat.tsx](src/components/Chat.tsx) listens to the SSE stream and PATCHes the session after each turn — the chat route itself does not touch disk.

### Tools ([src/lib/tools/](src/lib/tools/))

One file per group (`fs`, `shell`, `web`, `gmail`, `artifact`), each exporting `ToolSpec`s with a JSON-schema `parameters` and a `handler`. `index.ts` aggregates into `ALL_TOOLS` and exposes `toolsForOllama(enabled)` which returns the Ollama-shaped `function` definitions for only the enabled tools. New tools: add the file, import into `index.ts`, done — the UI picks them up via `GET /api/tools`.

### Artifact runtime ([public/artifact-runtime.html](public/artifact-runtime.html), [src/lib/artifacts.ts](src/lib/artifacts.ts))

Model emits a <code>\`\`\`react-artifact</code> fence with `// id:` / `// title:` headers. [src/components/Markdown.tsx](src/components/Markdown.tsx) detects it, POSTs the source to `/api/artifacts` (dedup by SHA-256), renders an inline card, and the RHS `ArtifactPanel` loads `/artifact-runtime.html` in an iframe. The iframe rewrites ES imports to destructure from globals (`Recharts`, `Papa`), Babel-transforms JSX, and mounts `<App/>` inside an error boundary. Data access is only via `Sahayak.fetchData('<filename>')` → `postMessage` → `GET /api/artifact-data/<id>/<filename>`; the iframe is otherwise network-sandboxed.

**Do not bump these pins** without reading the comments in the HTML:
- React **18.3.1 UMD** (React 19 ships no UMD build)
- Recharts **2.15.4** from `unpkg.com/recharts@2.15.4/umd/Recharts.js` (`.min.js` 404s on unpkg)
- Babel Standalone 7.27.0, PapaParse 5.5.3

The model-facing prompt that describes this pipeline is the `DEFAULT_SYSTEM_PROMPT` literal in [src/lib/store.ts](src/lib/store.ts) — edit there to change how the model uses artifacts.

### Themes

Three hand-designed themes (`correspondence` default, `terminal`, `editorial`) × light/dark, switched at runtime by swapping a `theme-*` class on `<html>`. Tokens are CSS custom properties in [src/app/globals.css](src/app/globals.css); components consume them via Tailwind color aliases like `bg-bg-paper`, `text-fg-muted`, `border-accent`. `next-themes` handles dark mode.

## Conventions worth internalizing

- **Bubbles for user turns, open prose for assistant turns.** Don't "unify" them. See [src/components/Chat.tsx](src/components/Chat.tsx).
- **Model picker lives in the assistant editor only**, never in the chat header.
- Tooltips use the `.tt[data-tip]` / `.tt-above` CSS helpers — not the native `title` attribute.
- Commit messages are multi-line, what + why.

# Sahayak — handover

Session handover from the assistant that built this. New session should start in `/srv/work/sahayak/` (the previous session was accidentally rooted at `/srv/work/agent-tools/`, which is why this doc exists).

---

## 1. What Sahayak is

Local-first AI chat client for Ollama. Purpose-built to replace OpenWebUI (slow + hides tools) for Sagar's daily use. Features built so far:

- **Assistants** — named personas with emoji, color, model, system prompt, enabled tool set, thinking effort
- **Streaming chat** — tool-calling loop with up to 8 tool turns, thinking surfaced as collapsible italic marginalia, images, regenerate button on last user message
- **Artifacts v1** — Claude-desktop-style: model emits `\`\`\`react-artifact` fence → inline card → RHS iframe panel with React 18 + Recharts + PapaParse preloaded; data bridge via `postMessage`; source-hash dedup; error boundary
- **Stats v1** — `/stats` page with totals, 14-day bar chart, assistants table, models share; home card stats strip; session token tag in sidebar; header link to stats
- **Tools** — filesystem (6), shell (1), web (2, via ollama cloud), gmail (4, shells to `/srv/work/agent-tools/gmail_agent.py`), artifact workspace (2)
- **Themes** — Correspondence (default, warm paper + sienna), Terminal Scholar (mono + amber), Editorial (cream + ochre); light/dark × 3 themes switchable at runtime
- **JSONL storage** — assistants in `data/assistants.json`, sessions as JSONL per assistant, content-addressed uploads, per-artifact dirs with source.jsx + files/
- **Markdown** — custom prose CSS (no @tailwindcss/typography), Shiki for code, auto-unfurled standalone URLs as LinkCards, tool result cards with structured per-tool rendering
- **Export** — per-session markdown dump with thinking, tool calls, and results

---

## 2. Repo + remote

- **Path:** `/srv/work/sahayak/`
- **GitHub:** https://github.com/sagarmainkar/sahayak
- **Main branch:** `main`
- **Auth:** token in `/srv/work/sahayak/.env` as `GITHUB_TOKEN` (gitignored). Push pattern:
  ```bash
  set -a && source .env && set +a
  git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/sagarmainkar/sahayak.git"
  git push origin main
  git remote set-url origin "https://github.com/sagarmainkar/sahayak.git"  # strip token
  ```
- **Commit email:** `sagar.mainkar@gmail.com` (use `-c user.email=...` per-commit, don't set globally)

---

## 3. Uncommitted changes (as of 2026-04-20 end-of-session)

Analytics v1 is fully working but **not yet pushed**. Needs a commit.

```
Modified:
  src/components/AssistantCard.tsx        # home card now shows chats/tokens/last-active strip
  src/components/Chat.tsx                 # session token tag in sidebar, fmt import
  src/components/Header.tsx               # /stats link with BarChart3 icon
  src/lib/artifacts.ts                    # listArtifacts skips non-dir entries and invalid ids (fixes _by_hash.json crash)
  src/lib/store.ts                        # new listSessionMetas() — reads first JSONL line only (fast for analytics)

Added:
  src/app/api/stats/route.ts              # GET /api/stats — GlobalStats
  src/app/api/stats/assistant/[id]/route.ts  # GET /api/stats/assistant/<id>
  src/app/stats/page.tsx                  # /stats page
  src/lib/analytics.ts                    # computeGlobalStats / computeAssistantStats
  src/lib/fmt.ts                          # fmtTokens / fmtRelative / fmtCompactNumber
```

**Recommended first action of new session:** commit + push. Suggested message:

```
analytics v1: per-assistant stats, global dashboard, session token tags

- /api/stats + /api/stats/assistant/<id> — aggregates from JSONL meta lines only (fast).
- /stats page: totals row, 14-day stacked bar chart, assistants table, models share bars.
- Home assistant cards show chats · tokens · last-active strip.
- Session sidebar shows compact token tag per session.
- Header BarChart3 link to /stats.
- listSessionMetas() reads only the first meta line of each JSONL.
- Fixed listArtifacts crash on non-dir entries in data/artifacts/ (e.g. _by_hash.json).
```

---

## 4. Next planned — do these in the new session

Agreed with Sagar last:

### ⭐ Tomorrow's work (these two, ~2.5 hrs total)

#### A. Inline SVG / Mermaid rendering in markdown
**Why:** Quickest visual win. Lets the assistant draw, not just type.

Scope:
- Detect `\`\`\`svg` fenced blocks → sanitize (dompurify or small allowlist) → render inline
- Detect `\`\`\`mermaid` blocks → render via Mermaid.js
- Detect complete `<html>` docs in a `\`\`\`html` fence → route to the existing artifact iframe (reuse pipeline, just a new language tag)
- Do NOT allow bare inline HTML in markdown (XSS risk)

Touch points:
- `src/components/Markdown.tsx` — add fence handlers alongside existing `react-artifact` / `carousel`
- New: `src/components/SvgBlock.tsx`, `src/components/MermaidBlock.tsx`
- `npm install mermaid dompurify` (plus types)
- System prompt — add a short note: *"For static diagrams use ```mermaid or ```svg. For interactive use ```react-artifact."*

#### B. Per-assistant memory / pinned facts
**Why:** Makes assistants *feel* personal across weeks.

Scope:
- Second textarea on the assistant editor: "Things to always remember about me / this project"
- Backend: add `memory: string` field on Assistant type; save with the rest
- Inject into system prompt on every turn: `System: ${systemPrompt}\n\nRemember:\n${memory}`
- `/remember <text>` slash command in the chat composer: appends a line to the assistant's memory, confirms with a toast/inline note
- Version the memory (simple: keep last 5 snapshots as `data/assistants.json` → `memory_history: string[]`)

Touch points:
- `src/lib/types.ts` — add `memory` field to Assistant
- `src/lib/store.ts` — read/write the new field
- `src/components/AssistantEditor.tsx` — new section "Memory"
- `src/app/api/chat/route.ts` — concatenate memory into system prompt
- `src/components/Composer.tsx` — detect `/remember` slash commands before sending

### Nice-to-haves from the backlog (not yet scheduled)

- **Session search** (~1.5h) — top-bar field, grep JSONLs, group by assistant
- **Tool builder UI** (~2h) — create custom tools at runtime via form, saved to `data/tools/<slug>.json`, merged into dispatch
- **Paste-error-to-chat button** (~30m) — on artifact iframe error, one-click "send this error to the assistant" action
- **PDF / doc attachment** (~2h) — expand uploads beyond images; extract text via `pdftotext` or pypdf
- **Assistant import/export** (~45m) — single `.sahayak.json` file, drag to import
- **⌘K command palette** (~1.5h) — switch assistant/session, toggle tool, new chat, stop stream
- **Multi-assistant conference** (~3h) — two assistants in one thread, each replies to the other
- **Vendor-bundle iframe deps** — mirror React/Recharts/Papa/Babel under `/public/vendor/` for offline use

---

## 5. Key architectural notes new session shouldn't trip over

### Data layout
```
data/
  assistants.json                              # array of Assistant
  sessions/<assistantId>/<sessionId>.jsonl     # line 1 meta, rest {type:"message",data:...}
  uploads/<sha256>.<ext>                       # content-addressed images
  artifacts/
    _by_hash.json                              # source-hash → artifact id (dedup)
    <id>/
      meta.json                                # { id, title, sessionId, assistantId, createdAt, updatedAt }
      source.jsx                               # React component as the model wrote it
      files/                                   # CSVs etc. the artifact loads via Sahayak.fetchData
```

**All of `/data` is gitignored.** Don't try to commit session chats.

### Runtime pipeline (artifacts)
- Markdown renderer detects `language-react-artifact` (or `language-react` with `// title:` header or `export default function`) → `ArtifactBlock`
- `ArtifactBlock` POSTs source to `/api/artifacts` — server dedups by SHA-256 hash and writes `data/artifacts/<id>/source.jsx`
- Click inline card → `ArtifactPanel` on RHS loads iframe `/artifact-runtime.html` with source posted via `postMessage`
- Iframe sanitizes ES imports (auto-destructures `{ X } = React`, `{ LineChart } = Recharts`, etc.), Babel-transforms JSX, `eval`s the result, mounts `<App/>` inside an error boundary
- Data bridge: artifact calls `Sahayak.fetchData('data.csv')` → iframe postMessages parent → parent hits `/api/artifact-data/<id>/<filename>` → responds with text/JSON

### Runtime pins that must stay
- React **18.3.1 UMD** (React 19 has no UMD build — **do not upgrade**)
- Recharts **2.15.4** at `https://unpkg.com/recharts@2.15.4/umd/Recharts.js` (note: `.min.js` path is a 404 — non-minified is the only UMD served)
- Babel Standalone 7.27.0, PapaParse 5.5.3

### Ollama
- Server: `http://localhost:11434`
- API key for hosted search: `~/.openclaw/credentials/ollama.json` (field `api_key`). Sahayak reads this automatically if `OLLAMA_API_KEY` env isn't set.
- Custom num_ctx modelfiles at `~/ollama-modelfiles/`: `qwen3.5:9b_128k`, `gemma4:e4b_128k`, `gemma4:26b_64k`
- Cloud models (no VRAM): `qwen3.5:397b-cloud`, `kimi-k2.5:cloud`, `gemini-3-flash-preview:cloud`, `minimax-m2.7:cloud`

### Python + yfinance for stock artifacts
Installed in `/srv/work/agent-tools/.venv/`. Model reaches these via `execute_command` bash which finds `python3` on PATH (resolves to that venv). If setting up on a fresh machine, install yfinance + pandas in whichever python3 bash finds first.

---

## 6. Running the app

```bash
cd /srv/work/sahayak
npm run dev                  # http://localhost:9999
```

Access from your laptop: `ssh -L 9999:localhost:9999 ubuntu@<ec2-ip>` → `http://127.0.0.1:9999`.

**Known port gotcha:** if OpenWebUI is also running natively, it grabs 9999 — stop it first (`docker compose down` wherever that's managed, or kill the native process).

---

## 7. Memory (for new Claude Code session)

Memory files are migrated to the new project path:
```
/home/ubuntu/.claude/projects/-srv-work-sahayak/memory/
├── MEMORY.md
├── user_sagar.md
├── project_sahayak.md
├── feedback_preferences.md
└── reference_ollama_infra.md
```

The new session should auto-load these on first user message. If it doesn't, point the new session at `/home/ubuntu/.claude/projects/-srv-work-sahayak/memory/MEMORY.md` explicitly.

Also copied the same files to `/home/ubuntu/.claude/projects/-srv-work-agent-tools/memory/` (the old project key) — safe to delete from there after first new-session pickup.

---

## 8. Sagar's preferences I shouldn't re-litigate (quick list; full in `feedback_preferences.md`)

- **Simple over clever.** Drop flaky features rather than iterate forever.
- **JSONL > SQLite** for single-user storage.
- **Bubbles for user / open prose for assistant.** Don't undo this.
- **Model picker stays in the assistant editor only.** Never in the chat header.
- **Tooltips use `.tt[data-tip]`** CSS class, not native `title`. `.tt-above` for composer.
- **Correspondence theme default.** Don't hardcode indigo/purple palettes.
- **Local 9B models need prescriptive prompts** — enumerate constraints. Cloud models one-shot.
- **Artifact runtime forgives** ES imports and `export default` — keep it forgiving.
- Commit messages multi-line with what/why.

---

## 9. Things a new session might be tempted to do that would be wrong

- **"Let's rewrite in Svelte / Vue / vanilla"** — no, Next.js 16 + React 19 is the chosen stack.
- **"Let's use SQLite for sessions"** — explicitly rejected; JSONL is the contract. Keep it.
- **"Let's add real-time collaboration / multi-user auth"** — single-user app. Skip it.
- **"Let's upgrade Recharts to 3.x / React to 19 in the iframe"** — React 19 has no UMD, Recharts 3.x path doesn't work on unpkg. Pinned for a reason.
- **"Let's cache stats in a DB / background index"** — Sagar asked for simple. Read JSONLs. That's fast enough.

---

## 10. First moves for the new session

1. **Commit the analytics work** (see section 3).
2. Ask Sagar which feature to start: SVG/Mermaid or Memory. Default is both, in that order (SVG/Mermaid first — it's faster and more visually satisfying).
3. Confirm `npm run dev` still boots on 9999.
4. If anything's unclear, read the memory files before asking.

Good luck, new session. This is a nice app; preserve the feel.

# Artifact External Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misleading "never fetch external URLs" paragraph in the artifact-mode prompt with explicit encouragement to include external HTTPS images, plus image-hygiene guidance.

**Architecture:** Single string literal change inside `REACT_ARTIFACT_INSTRUCTIONS` in `src/lib/store.ts`. No settings, no UI, no chat-route or sandbox changes. Existing artifacts continue to render unchanged because the iframe sandbox already permits external image fetches — the prompt was the only gate.

**Tech Stack:** Next.js 16 + TypeScript template-literal string. Verification is `npx tsc --noEmit` and a manual artifact-mode chat smoke. No test suite per CLAUDE.md.

---

## File Structure

| File | Role |
| --- | --- |
| `src/lib/store.ts` | The only file. Lines 53-54 (the `Never fetch external URLs ... All data must come via Sahayak.fetchData('<filename>').` paragraph) get replaced with the new ~22-line image-encouragement block from the spec. |

The surrounding `Data pipeline for artifacts` block, the React-artifact fence example, and every other line of `REACT_ARTIFACT_INSTRUCTIONS` stay verbatim.

---

## Conventions

- Pre-existing typecheck noise: 3 errors in unrelated files (`src/app/api/sessions/[id]/export/route.ts:32`, `src/components/ToolCard.tsx:197`, `src/lib/seed.ts:1`). NOT regressions if they appear; any *other* error is.
- Working tree on `experiment/pi-mono-llm-layer` has unrelated WIP (`.gitignore`, `next.config.ts`, untracked) — use **explicit `git add src/lib/store.ts`** to avoid pulling them into this commit.
- Plain `git commit` (no signing). Multi-line message with the project's `Co-Authored-By` footer per CLAUDE.md.

---

### Task 1: Swap the "Never fetch external URLs" paragraph in `REACT_ARTIFACT_INSTRUCTIONS`

**Files:**
- Modify: `src/lib/store.ts:53-54` (inside the `REACT_ARTIFACT_INSTRUCTIONS` template literal)

- [ ] **Step 1: Confirm the existing text matches the anchor**

Run from `/srv/work/sahayak`:

```bash
sed -n '53,54p' src/lib/store.ts
```

Expected output (two lines, the leading whitespace is exactly as shown — no indent because we're inside a template literal):

```
Never fetch external URLs from inside the artifact — the iframe is
network-sandboxed. All data must come via Sahayak.fetchData('<filename>').
```

If those two lines don't match exactly (including the em-dash `—`, not a hyphen), STOP and report — the file has drifted from the plan and the edit anchor is wrong.

- [ ] **Step 2: Replace those two lines**

Use the Edit tool. The `old_string` is the exact two-line paragraph and the `new_string` is the spec's encouragement block, preserving template-literal whitespace.

`old_string`:

```
Never fetch external URLs from inside the artifact — the iframe is
network-sandboxed. All data must come via Sahayak.fetchData('<filename>').
```

`new_string`:

```
External images: include them when they make the artifact more readable or
more delightful. Use thoughtfully — pick sources that look professional and
load reliably:

- Stock imagery: images.unsplash.com (append \`?w=800&q=80&auto=format\` for
  reasonable bytes), upload.wikimedia.org for diagrams/maps/historical, or
  the user's own URLs if they provide them.
- Logos and icons: prefer official CDNs (e.g. simpleicons.org, devicons,
  brand asset pages). Avoid hotlinking from random blogs.
- For inline icons under ~5KB, prefer data: URIs to avoid network round-trips.

Image hygiene:
- Always set explicit \`width\` and \`height\` (or aspect ratio via CSS) so the
  layout doesn't reflow as images load.
- Use \`loading="lazy"\` for images below the fold.
- Use \`style={{objectFit: "cover"}}\` (or "contain") rather than letting the
  browser stretch.
- Use \`alt\` text — the artifact may be screenshotted into the chat.

Other external resources (scripts, stylesheets, custom fonts, fetch() to
other origins) — don't. Keep the artifact's runtime origin clean. App data
still comes via Sahayak.fetchData('<filename>').
```

**Critical**: every backtick in the new_string is escaped as `` \` `` because the surrounding template literal in `store.ts` is itself backtick-delimited. The escapes already exist on the existing line (e.g. `\`Recharts\`` at line 38). The new_string above shows the form that goes into the source file — when the literal evaluates at runtime, the `\` escapes resolve and the model sees plain backticks like `` `width` `` and `` `loading="lazy"` ``.

- [ ] **Step 3: Confirm the file still parses**

```bash
cd /srv/work/sahayak && npx tsc --noEmit 2>&1 | grep -v -E "(sessions/\[id\]/export|ToolCard\.tsx|seed\.ts)" | grep -E "^(src|error|TS)"
```

Expected: no output (the `grep -v` filters the 3 baseline errors; the second `grep` keeps only real source/error lines). If anything appears, the template literal didn't close properly — likely an unescaped backtick. Re-check Step 2's escapes.

A direct full-typecheck run is also useful:

```bash
cd /srv/work/sahayak && npx tsc --noEmit
```

Expected: only the 3 known pre-existing errors.

- [ ] **Step 4: Verify the new text reads correctly when evaluated**

```bash
cd /srv/work/sahayak && node -e "
  import('./src/lib/store.ts').then(m => {
    const t = m.REACT_ARTIFACT_INSTRUCTIONS;
    const start = t.indexOf('External images:');
    const end = t.indexOf('Minimal example:');
    console.log('--- new block (chars ' + start + '..' + end + ') ---');
    console.log(t.slice(start, end));
  });
" 2>/dev/null || npx tsx -e "
  import { REACT_ARTIFACT_INSTRUCTIONS } from './src/lib/store.ts';
  const start = REACT_ARTIFACT_INSTRUCTIONS.indexOf('External images:');
  const end = REACT_ARTIFACT_INSTRUCTIONS.indexOf('Minimal example:');
  console.log('--- new block (chars ' + start + '..' + end + ') ---');
  console.log(REACT_ARTIFACT_INSTRUCTIONS.slice(start, end));
"
```

Expected: the new block prints with backticks rendered correctly (e.g. `` `width` `` not `` \`width\` ``). If you see literal backslashes, the escapes are over-escaped and Step 2 needs to be redone with single backslashes.

If neither node nor npx tsx can load the TS module directly (path-alias handling), skip this step — the typecheck in Step 3 plus the dev-server smoke in Step 6 are sufficient.

- [ ] **Step 5: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/store.ts
git commit -m "$(cat <<'EOF'
artifacts: encourage external images with hygiene guidance

The previous "never fetch external URLs — the iframe is
network-sandboxed" line was misleading on two counts: the
iframe is sandbox="allow-scripts allow-same-origin" with no
CSP, so external <img> already worked; and it conflated app
data (which does need Sahayak.fetchData) with display assets
(which don't). Replace with explicit encouragement to use
HTTPS images from reputable sources (Unsplash, Wikimedia,
official CDNs) plus image hygiene (sizing, loading=lazy,
object-fit, alt text). The closing paragraph keeps scripts
/ stylesheets / cross-origin fetch() off-policy so the model
doesn't read this as an open invitation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Manual smoke against the dev server**

The dev server should still be running on port 9999 from prior work. If not, start it: `cd /srv/work/sahayak && nohup npm run dev > /tmp/sahayak-dev.log 2>&1 &` and wait ~15 seconds.

In a browser at `http://localhost:9999/`:

1. Open or create an assistant with artifact mode available.
2. Toggle artifact mode on (the Sparkles button in the composer, or the `+` menu's "Artifact mode" item on mobile).
3. Send: `make me a recipe card for shakshuka with a hero image and an ingredient list. one cohesive react component.`
4. Confirm the rendered artifact includes an `<img src="https://images.unsplash.com/...">` (or wikimedia / similar HTTPS source) with `width`, `height`, `loading="lazy"`, `alt`, and reasonable `objectFit` styling.
5. Open an artifact from a previous session (created before this commit). Confirm it still renders the same way it always did — the prompt change only affects newly-generated artifacts.

If the model emits `<img>` without the suggested attributes, the prompt is doing its main job (allowing external images) but the hygiene nudges aren't landing. That's a model-quality issue, not a prompt-correctness issue — accept it for v1 and refine the prompt language in a follow-up if real-world usage shows the hygiene guidance being ignored.

---

## Self-review

**1. Spec coverage**

| Spec section | Implemented in | Status |
| --- | --- | --- |
| Replace the "never fetch external URLs" paragraph with the encouragement block | Task 1 Step 2 | ✅ |
| Keep the surrounding `Data pipeline` block + minimal example unchanged | Task 1 Step 2 anchors only the two-line paragraph | ✅ |
| No settings, no UI, no toggle | Plan touches only `src/lib/store.ts` | ✅ |
| No CSP work | Out of scope, not addressed | ✅ |
| Verification: artifact-mode prompt produces external images; old artifacts unchanged | Task 1 Step 6 | ✅ |

**2. Placeholder scan:** None. Every step shows actual code or commands. Step 4's "skip if path-alias handling fails" is an explicit fallback, not a placeholder.

**3. Type consistency:** N/A — string-literal change only, no types touched.

**Off-spec but pragmatic addition:** Step 4 adds a runtime-evaluation check of the resolved string content, which the spec doesn't require. Worth keeping because backtick-escaping inside a TS template literal is a common foot-gun (the kind of thing that compiles fine but renders garbled in the prompt the model sees).

---

## Execution Handoff

This plan is small enough — single file, single paragraph swap — that **inline execution is the right call**. No need to spin up subagents and reviewer pairs for what amounts to one Edit call plus a commit. The scope-to-overhead ratio doesn't justify subagent-driven development here.

I'll proceed inline (using superpowers:executing-plans) once you confirm.

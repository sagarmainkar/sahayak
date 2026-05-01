# Artifact Dedup + Project Python Venv Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the artifact-create loop (94 junk dirs from one prompt) and stop pip-installing into global Python — give the model a project-managed `.data/.venv` it can grow over time via a `pip_install` tool.

**Architecture:** Six tasks across six files, all on `experiment/pi-mono-llm-layer`. Foundational path constants first, then the artifact-create dedup (mirrors the existing memory-dedup pattern), then the venv plumbing (auto-prefix in `execute_command`, `ensureDataVenv` lazy helper, `pip_install` tool, register it), then the eager `setup-python.mjs` extension, then the system-prompt nudge.

**Tech Stack:** Next.js 16 + TypeScript, Node 20+, Python 3 (any 3.11+ on PATH). No new deps. Verification per task is `npx tsc --noEmit` (3 baseline errors are pre-existing) plus targeted curl/bash smokes against the dev server at port 9999.

---

## File Structure

| File | Role |
| --- | --- |
| `src/lib/paths.ts` | Add `DATA_VENV_DIR`, `DATA_VENV_PYTHON`, `DATA_VENV_PIP`, `DATA_REQUIREMENTS_FILE`. |
| `src/lib/tools/artifact.ts` | `artifact_create` handler gains the dedup branch. |
| `src/lib/tools/shell.ts` | `ensureDataVenv` helper + `execute_command` auto-prefix + new `pipInstall` tool export. |
| `src/lib/tools/index.ts` | Register `pipInstall` in `ALL_TOOLS`. |
| `scripts/setup-python.mjs` | Extend with `.data/.venv` block + seeded `requirements.txt`. |
| `src/lib/store.ts` | Insert "Python execution" paragraph in `REACT_ARTIFACT_INSTRUCTIONS`. |

---

## Conventions

- Pre-existing typecheck noise: 3 errors in unrelated files (`src/app/api/sessions/[id]/export/route.ts:32`, `src/components/ToolCard.tsx:197`, `src/lib/seed.ts:1`). NOT regressions if they appear; any other error is yours.
- Working tree on `experiment/pi-mono-llm-layer` has unrelated WIP (`.gitignore`, `next.config.ts`, untracked) — use **explicit `git add <file>`** to keep them out of these commits.
- Plain `git commit` (no signing). Multi-line messages with the project's `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer per CLAUDE.md.
- Dev server is running on port 9999. If it isn't: `cd /srv/work/sahayak && nohup npm run dev > /tmp/sahayak-dev.log 2>&1 &` then wait ~15s.

---

### Task 1: paths.ts — venv + requirements path constants

**Files:**
- Modify: `src/lib/paths.ts` (add 4 const declarations after line 37)

- [ ] **Step 1: Append the new constants**

In `src/lib/paths.ts`, find line 37 (`export const MEMORY_VEC_FILE = path.join(CONFIG_DIR, "memory.vec.jsonl");`). Immediately after it (before the existing blank line and the `// ── .data/ sweep marker ──` comment), insert:

```typescript

// Project Python venv that the model's execute_command/pip_install
// invocations resolve to. Distinct from python/.venv (Sahayak's
// own doc-parser venv) — that one stays at the repo root.
export const DATA_VENV_DIR = path.join(DATA_DIR, ".venv");
export const DATA_VENV_PYTHON = path.join(DATA_VENV_DIR, "bin", "python");
export const DATA_VENV_PIP = path.join(DATA_VENV_DIR, "bin", "pip");
export const DATA_REQUIREMENTS_FILE = path.join(DATA_DIR, "requirements.txt");
```

- [ ] **Step 2: Verify**

```bash
cd /srv/work/sahayak && npx tsc --noEmit 2>&1 | tail -10
```

Expected: only the 3 known pre-existing errors. The new exports are unused at this point, which is fine — TypeScript doesn't error on unused exports.

- [ ] **Step 3: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/paths.ts
git commit -m "$(cat <<'EOF'
paths: add DATA_VENV_* and DATA_REQUIREMENTS_FILE constants

Project Python venv at .data/.venv (distinct from python/.venv
which is Sahayak's internal doc-parser env). Used by the next
tasks: execute_command auto-prefix, pip_install tool, and
the setup-python.mjs extension that creates the venv eagerly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: artifact.ts — dedup in `artifact_create`

**Files:**
- Modify: `src/lib/tools/artifact.ts:41-78` (the entire `artifactCreate.handler` function)

- [ ] **Step 1: Replace the handler**

In `src/lib/tools/artifact.ts`, find the existing `async handler(args, ctx) { ... }` block of `artifactCreate` (lines 41-78). Replace it entirely with:

```typescript
  async handler(args, ctx) {
    if (!ctx) {
      return err(
        "no_context",
        "artifact_create requires an active chat session",
      );
    }
    const title =
      typeof args.title === "string" && args.title.trim()
        ? args.title.trim()
        : "artifact";

    const sessionArtifactsDir = artifactsDir(ctx.assistantId, ctx.sessionId);
    let existingIds: string[] = [];
    try {
      existingIds = await fs.readdir(sessionArtifactsDir);
    } catch {
      // No artifacts dir yet — that's fine, first artifact in the session.
    }

    let id: string;
    let dedupHit: string | null = null;

    if (typeof args.id === "string" && args.id.trim()) {
      const candidate = args.id.trim().toLowerCase();
      if (!validId(candidate)) {
        return err("bad_id", "id must match ^[a-z0-9][a-z0-9-]{0,80}$");
      }
      // Explicit id given — if it already exists, treat as already_exists.
      if (existingIds.includes(candidate)) {
        dedupHit = candidate;
      }
      id = candidate;
    } else {
      // No id — slugify the title and look for an existing artifact whose
      // id either equals the slug exactly or starts with `<slug>-`. That
      // catches the model creating successive artifacts with the same
      // title intent.
      const slug = slugify(title);
      const match = existingIds.find(
        (existing) => existing === slug || existing.startsWith(`${slug}-`),
      );
      if (match) {
        dedupHit = match;
        id = match;
      } else {
        id = `${slug}-${nanoid(8).replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
      }
    }

    const dir = path.join(
      artifactDir(ctx.assistantId, ctx.sessionId, id),
      "files",
    );
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(sessionArtifactsDir, { recursive: true });

    if (dedupHit) {
      return ok({
        status: "already_exists",
        id,
        files_path: dir,
        hint: `An artifact with id '${id}' already exists in this session. Update it by writing files into the same files_path and re-emitting the same // id: ${id} in your react-artifact fence — DO NOT call artifact_create again for the same logical artifact.`,
      });
    }

    return ok({
      status: "created",
      id,
      files_path: dir,
      hint: `Write data files here with artifact_write_file(id='${id}', filename=..., content=...). Then emit \`\`\`react-artifact with // id: ${id} and call Sahayak.fetchData('<filename>') inside your component.`,
    });
  },
```

The dedup logic:
- If the model passes an explicit `id` that already exists → return `already_exists` with the same id, hint nudges toward reuse.
- If `id` is omitted, slugify the title and scan existing artifacts for `slug` or `slug-*` matches → return existing if found.
- Otherwise create fresh as today (`<slug>-<nanoid8>`).
- Either way, the directory is created (idempotent via `recursive: true`) and `files_path` returned.

- [ ] **Step 2: Verify**

```bash
cd /srv/work/sahayak && npx tsc --noEmit 2>&1 | tail -10
```

Expected: only the 3 known pre-existing errors.

Live smoke (uses the dev server's tools API):

```bash
curl -s http://localhost:9999/api/tools | jq '.tools[] | select(.name == "artifact_create") | .description'
```

Expected: prints the existing description string (we didn't change description).

- [ ] **Step 3: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/tools/artifact.ts
git commit -m "$(cat <<'EOF'
artifact_create: server-side dedup on session artifacts

When the model passes an existing explicit id, OR when it
omits id and the slugified title prefix-matches an existing
artifact in this session, return {status:"already_exists",
id:<existing>} with a hint nudging the model to reuse the
same id in its react-artifact fence rather than creating a
fresh one. Mirrors the remember tool's dedup. Stops the
loop where iterative refinement creates a new artifact dir
per turn.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: shell.ts — `ensureDataVenv` + `execute_command` auto-prefix

**Files:**
- Modify: `src/lib/tools/shell.ts` (entire file — currently 57 lines, becomes ~140)

- [ ] **Step 1: Replace the file**

The current file is small. Replace `src/lib/tools/shell.ts` entirely with:

```typescript
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import {
  DATA_DIR,
  DATA_REQUIREMENTS_FILE,
  DATA_VENV_DIR,
  DATA_VENV_PIP,
  DATA_VENV_PYTHON,
} from "@/lib/paths";
import { err, ok, type ToolSpec } from "./types";

const pexec = promisify(execFile);

const DEFAULT_REQUIREMENTS = [
  "matplotlib",
  "numpy",
  "pandas",
  "requests",
  "yfinance",
];

/** Lazy-create .data/.venv on first Python invocation if the user
 *  skipped `npm run setup:python`. Returns whether we created it,
 *  so the caller can surface a one-line note. */
async function ensureDataVenv(): Promise<{ created: boolean }> {
  if (existsSync(DATA_VENV_PYTHON)) return { created: false };
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Seed requirements.txt if absent.
  if (!existsSync(DATA_REQUIREMENTS_FILE)) {
    await fs.writeFile(
      DATA_REQUIREMENTS_FILE,
      DEFAULT_REQUIREMENTS.join("\n") + "\n",
    );
  }
  // Create venv via system python3.
  await pexec("python3", ["-m", "venv", DATA_VENV_DIR], {
    timeout: 60_000,
  });
  // Upgrade pip and install requirements.
  await pexec(DATA_VENV_PYTHON, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"], {
    timeout: 120_000,
  });
  await pexec(
    DATA_VENV_PYTHON,
    ["-m", "pip", "install", "--quiet", "-r", DATA_REQUIREMENTS_FILE],
    { timeout: 600_000 },
  );
  return { created: true };
}

/** Rewrite python/python3/pip/pip3 leading tokens in each shell segment
 *  to the venv binaries. Anchored on `^` of each segment after stripping
 *  leading whitespace. Only the FIRST token of a segment is rewritten. */
function applyVenvPrefix(cmd: string): { rewritten: string; touched: boolean } {
  // Split on shell separators while keeping the separators so we can rejoin.
  const parts = cmd.split(/(\s*(?:&&|\|\||;|\|)\s*)/);
  let touched = false;
  const out = parts.map((part) => {
    // Separator tokens go through unchanged.
    if (/^\s*(?:&&|\|\||;|\|)\s*$/.test(part)) return part;
    // Strip leading whitespace, capture it for restoration.
    const m = part.match(/^(\s*)(\S+)(.*)$/s);
    if (!m) return part;
    const [, lead, first, rest] = m;
    const rewritten = (() => {
      if (first === "python" || first === "python3") return DATA_VENV_PYTHON;
      if (first === "pip" || first === "pip3") return DATA_VENV_PIP;
      return null;
    })();
    if (!rewritten) return part;
    touched = true;
    return `${lead}${rewritten}${rest}`;
  });
  return { rewritten: out.join(""), touched };
}

export const executeCommand: ToolSpec = {
  name: "execute_command",
  group: "shell",
  description: "Run a shell command. Returns exit code, stdout, stderr.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      working_directory: { type: "string" },
      timeout: { type: "integer", description: "seconds, default 60, max 120" },
    },
    required: ["command"],
  },
  async handler(args) {
    try {
      const cmdRaw = args.command as string;
      if (!cmdRaw || typeof cmdRaw !== "string")
        return err("bad_args", "command required");
      const timeout =
        Math.max(1, Math.min(120, Number(args.timeout ?? 60))) * 1000;
      const cwd = (args.working_directory as string) || undefined;

      const { rewritten: cmd, touched: pythonRewritten } = applyVenvPrefix(cmdRaw);
      let venvLazyCreated = false;
      if (pythonRewritten) {
        const status = await ensureDataVenv();
        venvLazyCreated = status.created;
      }

      try {
        const { stdout, stderr } = await pexec("bash", ["-lc", cmd], {
          cwd,
          timeout,
          maxBuffer: 1024 * 1024,
        });
        return {
          ok: true,
          command: cmdRaw,
          ...(pythonRewritten ? { python_venv: DATA_VENV_DIR } : {}),
          ...(venvLazyCreated ? { python_venv_lazy_created: true } : {}),
          cwd: cwd ?? process.cwd(),
          exit_code: 0,
          stdout: stdout.slice(0, 256 * 1024),
          stderr: stderr.slice(0, 256 * 1024),
        };
      } catch (e) {
        const ex = e as { code?: number; killed?: boolean; stdout?: string; stderr?: string; message?: string };
        return {
          ok: false,
          error: ex.killed ? "timeout" : "non_zero_exit",
          command: cmdRaw,
          ...(pythonRewritten ? { python_venv: DATA_VENV_DIR } : {}),
          ...(venvLazyCreated ? { python_venv_lazy_created: true } : {}),
          exit_code: ex.code ?? -1,
          stdout: (ex.stdout ?? "").slice(0, 256 * 1024),
          stderr: (ex.stderr ?? ex.message ?? "").slice(0, 256 * 1024),
        };
      }
    } catch (e) {
      return err("internal", (e as Error).message);
    }
  },
};

export const pipInstall: ToolSpec = {
  name: "pip_install",
  group: "shell",
  description:
    "Install one or more Python packages into the project's .data/.venv AND " +
    "append them to .data/requirements.txt so the dependency persists across " +
    "sessions. Prefer this over `pip install` in execute_command — it keeps " +
    "the requirements file in sync with what's installed.",
  parameters: {
    type: "object",
    properties: {
      packages: {
        type: "string",
        description:
          "One or more pip package specs separated by spaces, e.g. \"yfinance pandas\" or \"requests==2.31.0\".",
      },
    },
    required: ["packages"],
  },
  async handler(args) {
    const packagesRaw = String(args.packages ?? "").trim();
    if (!packagesRaw) return err("bad_args", "packages required");
    const packages = packagesRaw.split(/\s+/).filter(Boolean);
    if (packages.length === 0) return err("bad_args", "no packages parsed");

    const status = await ensureDataVenv();

    try {
      const { stdout, stderr } = await pexec(
        DATA_VENV_PIP,
        ["install", ...packages],
        { timeout: 600_000, maxBuffer: 1024 * 1024 },
      );

      // Append to requirements.txt: extract bare package names (drop
      // version specifiers and extras), merge with existing, sort,
      // dedupe, write back.
      const installed = packages.map((p) => p.split(/[=<>!~\[]/)[0].trim()).filter(Boolean);
      let current: string[] = [];
      if (existsSync(DATA_REQUIREMENTS_FILE)) {
        const raw = await fs.readFile(DATA_REQUIREMENTS_FILE, "utf8");
        current = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      }
      const merged = Array.from(new Set([...current, ...installed])).sort();
      await fs.writeFile(DATA_REQUIREMENTS_FILE, merged.join("\n") + "\n");

      return ok({
        installed,
        requirements_path: DATA_REQUIREMENTS_FILE,
        venv_lazy_created: status.created,
        stdout: stdout.slice(0, 64 * 1024),
        stderr: stderr.slice(0, 64 * 1024),
      });
    } catch (e) {
      const ex = e as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        error: "pip_install_failed",
        exit_code: ex.code ?? -1,
        stdout: (ex.stdout ?? "").slice(0, 64 * 1024),
        stderr: (ex.stderr ?? ex.message ?? "").slice(0, 64 * 1024),
      };
    }
  },
};
```

Notes on the rewrite:
- `applyVenvPrefix` only rewrites at segment-start positions, so `echo "use python to run this"` stays untouched.
- `ensureDataVenv` is only called when auto-prefix actually fired — non-Python commands skip the cost entirely.
- The original `executeCommand` shape (`ok`, `error`, `command`, `exit_code`, `stdout`, `stderr`, `cwd`) is preserved; new fields (`python_venv`, `python_venv_lazy_created`) are conditional.
- `pip_install`'s package-name extraction strips version specifiers (`==`, `>=`, `<=`, `~=`, `!=`) and extras (`[`).
- All paths come from `paths.ts` constants so `SAHAYAK_DATA_DIR` env override is respected.

- [ ] **Step 2: Typecheck**

```bash
cd /srv/work/sahayak && npx tsc --noEmit 2>&1 | tail -10
```

Expected: only the 3 known pre-existing errors. If you see a new error like "Cannot find name 'pipInstall'", that's fine — it's because we haven't registered it in `tools/index.ts` yet (Task 4).

- [ ] **Step 3: Smoke (dev server)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/
```

Expected: 200. (Confirms the file change didn't break TS bundling.)

- [ ] **Step 4: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/tools/shell.ts
git commit -m "$(cat <<'EOF'
execute_command: auto-prefix python/pip to .data/.venv

Adds applyVenvPrefix that rewrites leading python/python3/
pip/pip3 tokens in each shell segment to the venv binaries
at .data/.venv/bin/. Only the first token of each segment
is rewritten — `echo "use python..."` stays untouched.

Adds ensureDataVenv that lazy-creates the venv on first
Python invocation (seeded with pandas/numpy/requests/
yfinance/matplotlib if requirements.txt is absent), so
users who skipped npm run setup:python still get a working
env on first model use.

Also adds pip_install tool that installs into the venv AND
appends bare package names to .data/requirements.txt so
the dependency persists. Will be registered in tools/index
in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Register `pipInstall` in `tools/index.ts`

**Files:**
- Modify: `src/lib/tools/index.ts:10` (import) and line ~22-35 (`ALL_TOOLS` array)

- [ ] **Step 1: Update the import**

In `src/lib/tools/index.ts`, find line 10:

```typescript
import { executeCommand } from "./shell";
```

Replace with:

```typescript
import { executeCommand, pipInstall } from "./shell";
```

- [ ] **Step 2: Add to `ALL_TOOLS`**

A few lines below, find the `ALL_TOOLS` array. It currently contains `executeCommand` on its own line (~line 28). Add `pipInstall` immediately after it:

Before:

```typescript
export const ALL_TOOLS: ToolSpec[] = [
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  getFileInfo,
  pathExists,
  executeCommand,
  webSearch,
  webFetch,
  artifactCreate,
  artifactWriteFile,
  gmailSearch,
  gmailRead,
];
```

After:

```typescript
export const ALL_TOOLS: ToolSpec[] = [
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  getFileInfo,
  pathExists,
  executeCommand,
  pipInstall,
  webSearch,
  webFetch,
  artifactCreate,
  artifactWriteFile,
  gmailSearch,
  gmailRead,
];
```

- [ ] **Step 3: Verify**

```bash
cd /srv/work/sahayak && npx tsc --noEmit 2>&1 | tail -10
```

Expected: only the 3 known pre-existing errors.

```bash
curl -s http://localhost:9999/api/tools | jq '.tools[] | select(.name == "pip_install")'
```

Expected: prints the `pip_install` tool spec (name, group, description, parameters).

- [ ] **Step 4: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/tools/index.ts
git commit -m "$(cat <<'EOF'
tools: register pip_install in ALL_TOOLS

Surface the new pip_install tool (added to shell.ts in the
previous commit) in the assistant editor's tool picker so it
can be enabled per-assistant alongside execute_command.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: setup-python.mjs — extend with `.data/.venv` block

**Files:**
- Modify: `scripts/setup-python.mjs` (append block after the existing "✓ done" line)

- [ ] **Step 1: Read the current file**

```bash
cat /srv/work/sahayak/scripts/setup-python.mjs
```

Confirm it ends with the `main()` invocation followed by the catch block (no trailing logic after).

- [ ] **Step 2: Add data-venv handling**

In `scripts/setup-python.mjs`, find the `main()` function. It currently ends with:

```javascript
  console.log("✓ done. Sahayak can now parse encrypted PDFs and rich Office files.");
}
```

Replace that final block with the version below — it adds a second venv setup phase that targets `.data/.venv` and a seeded `requirements.txt`. The first-phase work (encrypted PDFs + officeparser deps) is unchanged.

```javascript
  console.log("✓ python/.venv ready (officeparser + encrypted PDFs).");

  // Phase 2: project Python venv at .data/.venv that the model's
  // execute_command/pip_install resolves to. Distinct from python/.venv
  // (Sahayak-internal). Lives under .data/ so it's gitignored and grows
  // with the user's session deps.
  const DATA_DIR = process.env.SAHAYAK_DATA_DIR ?? path.join(ROOT, ".data");
  const DATA_VENV = path.join(DATA_DIR, ".venv");
  const DATA_VENV_PY = IS_WIN
    ? path.join(DATA_VENV, "Scripts", "python.exe")
    : path.join(DATA_VENV, "bin", "python3");
  const DATA_REQ = path.join(DATA_DIR, "requirements.txt");

  const fsPromises = await import("node:fs/promises");
  await fsPromises.mkdir(DATA_DIR, { recursive: true });

  if (!existsSync(DATA_REQ)) {
    console.log(`  seeding ${path.relative(ROOT, DATA_REQ)} with default bundle`);
    await fsPromises.writeFile(
      DATA_REQ,
      ["matplotlib", "numpy", "pandas", "requests", "yfinance"].join("\n") + "\n",
    );
  } else {
    console.log(`  reusing existing ${path.relative(ROOT, DATA_REQ)}`);
  }

  if (!existsSync(DATA_VENV)) {
    console.log(`  creating data virtualenv at ${path.relative(ROOT, DATA_VENV)}`);
    await run(pythonCmd, ["-m", "venv", DATA_VENV]);
  } else {
    console.log(`  reusing existing data virtualenv at ${path.relative(ROOT, DATA_VENV)}`);
  }

  console.log("  upgrading data-venv pip");
  await run(DATA_VENV_PY, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);

  console.log("  installing data requirements (this can take a minute)");
  await run(DATA_VENV_PY, ["-m", "pip", "install", "--quiet", "-r", DATA_REQ]);

  console.log(
    `✓ ${path.relative(ROOT, DATA_VENV)} ready with: matplotlib, numpy, pandas, requests, yfinance.`,
  );
  console.log("");
  console.log(
    "  Done. The model's execute_command auto-resolves python/pip to .data/.venv.",
  );
  console.log(
    "  Use pip_install({packages: \"X\"}) to add new deps — it updates requirements.txt too.",
  );
}
```

The script is idempotent — re-running on an existing setup just refreshes pip + reinstalls from requirements.txt (a no-op when nothing changed).

- [ ] **Step 3: Verify the script runs end-to-end**

First, prove it works on a clean `.data/.venv` state:

```bash
cd /srv/work/sahayak
rm -rf .data/.venv .data/requirements.txt
npm run setup:python
```

Expected output (the "phase 1" portion stays identical to today; the "phase 2" lines are new):

```
→ Sahayak Python setup
  reusing existing virtualenv at python/.venv
  upgrading pip
  installing requirements
✓ python/.venv ready (officeparser + encrypted PDFs).
  seeding .data/requirements.txt with default bundle
  creating data virtualenv at .data/.venv
  upgrading data-venv pip
  installing data requirements (this can take a minute)
✓ .data/.venv ready with: matplotlib, numpy, pandas, requests, yfinance.

  Done. The model's execute_command auto-resolves python/pip to .data/.venv.
  Use pip_install({packages: "X"}) to add new deps — it updates requirements.txt too.
```

Confirm both files now exist:

```bash
ls -la .data/.venv/bin/python .data/requirements.txt
cat .data/requirements.txt
```

Expected: paths exist; requirements.txt has 5 lines (alphabetical).

Then prove it's idempotent — re-run and confirm it doesn't error:

```bash
npm run setup:python
```

Expected: same output but with "reusing existing data virtualenv at .data/.venv" instead of "creating".

- [ ] **Step 4: Commit**

```bash
cd /srv/work/sahayak
git add scripts/setup-python.mjs
git commit -m "$(cat <<'EOF'
setup-python: also create .data/.venv with default bundle

Extends the existing setup script with a phase-2 block that
creates .data/.venv (Python venv for the model's
execute_command/pip_install) and seeds .data/requirements.txt
with matplotlib/numpy/pandas/requests/yfinance. Distinct
from the existing python/.venv which stays as-is for
Sahayak's officeparser + encrypted-PDF deps.

The phase-2 block reuses the helpers (which, run) from phase
1. Idempotent — re-running on an existing setup just refreshes
pip and reinstalls from requirements.txt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: System prompt — Python execution paragraph

**Files:**
- Modify: `src/lib/store.ts` (insert paragraph in `REACT_ARTIFACT_INSTRUCTIONS`)

- [ ] **Step 1: Find the insertion point**

In `src/lib/store.ts`, the `REACT_ARTIFACT_INSTRUCTIONS` constant has an "External images:" paragraph (added in the prior task on this branch). The Python paragraph goes immediately BEFORE "External images:" so the order is:

1. "Interactive artifact requested ..."
2. "Data pipeline for artifacts ..."
3. **Python execution** (new)
4. "External images: ..."
5. "Minimal example: ..."

Run this to confirm the current "External images:" anchor:

```bash
cd /srv/work/sahayak && grep -n "External images:" src/lib/store.ts
```

Expected: one match. Note the line number for context.

- [ ] **Step 2: Insert the Python paragraph**

The new paragraph (note backticks must be escaped because the surrounding literal is itself backtick-delimited, like the prior task — see the `\`X\`` form below):

Use the Edit tool with these exact strings.

`old_string`:

```
External images: include them when they make the artifact more readable or
more delightful. Use thoughtfully — pick sources that look professional and
load reliably:
```

`new_string`:

```
Python execution
- All \`python\` / \`pip\` invocations in execute_command auto-resolve to the
  project's .data/.venv. You don't need to source-activate; just write
  \`python script.py\` or \`pip install pandas\` as normal.
- To add a new package, prefer \`pip_install({packages: "X"})\` — it both
  installs into the venv AND appends X to .data/requirements.txt so the
  dependency persists. Plain \`pip install X\` works but won't update the
  requirements file.
- Pre-installed: pandas, numpy, requests, yfinance, matplotlib.
- Do NOT use sudo, system pip, or global pip — they're never needed
  here, and a leaked global install is confusing later.

External images: include them when they make the artifact more readable or
more delightful. Use thoughtfully — pick sources that look professional and
load reliably:
```

(The Python paragraph is inserted immediately before the existing "External images:" block; the existing block is included verbatim in `new_string` so it stays where it was.)

- [ ] **Step 3: Verify the resolved string**

```bash
cd /srv/work/sahayak && npx tsx -e "
import { REACT_ARTIFACT_INSTRUCTIONS } from './src/lib/store';
const start = REACT_ARTIFACT_INSTRUCTIONS.indexOf('Python execution');
const end = REACT_ARTIFACT_INSTRUCTIONS.indexOf('External images:');
console.log('--- python block (chars ' + start + '..' + end + ') ---');
console.log(REACT_ARTIFACT_INSTRUCTIONS.slice(start, end));
"
```

Expected: prints the Python paragraph with backticks rendered correctly (e.g. `` `python` ``, `` `pip_install({packages: "X"})` ``) — no literal backslashes. If you see `\`python\``, the escapes are over-escaped and Step 2 needs to be redone with single backslashes.

```bash
cd /srv/work/sahayak && npx tsc --noEmit 2>&1 | tail -10
```

Expected: only the 3 known pre-existing errors.

- [ ] **Step 4: Commit**

```bash
cd /srv/work/sahayak
git add src/lib/store.ts
git commit -m "$(cat <<'EOF'
artifacts: prompt-side note on Python venv + pip_install

Inserts a "Python execution" paragraph in REACT_ARTIFACT_
INSTRUCTIONS just before "External images:". Tells the model
that python/pip auto-resolve to .data/.venv (no source
activate needed), to prefer pip_install({packages:"X"}) over
plain pip install for persistence, lists the preinstalled
packages, and forbids global/sudo pip.

The runtime auto-prefix in execute_command means the prompt
isn't load-bearing for correctness — it's load-bearing for
discoverability of pip_install.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## End-to-end verification

After all six tasks are committed, do the manual smoke that exercises every piece together. This is the same scenario the user hit:

1. **Reset to a clean state.** From `/srv/work/sahayak`:

   ```bash
   rm -rf .data/.venv .data/requirements.txt
   ```

2. **Pick the user's session.** The PowerGrid session was at `.data/AAft3EmyUcIT/yeF_e5rr-YQe/`. Either work in a brand-new chat session OR clean the existing junk artifact dirs first:

   ```bash
   # Optional: nuke the 94 stale artifacts so you can see the dedup work
   rm -rf .data/AAft3EmyUcIT/yeF_e5rr-YQe/artifacts/*
   ```

3. **Browser smoke (artifact mode + Python).** In Chrome at http://localhost:9999/:
   - Open an assistant with `execute_command`, `artifact_create`, `artifact_write_file`, and `pip_install` enabled.
   - Toggle artifact mode (Sparkles button).
   - Send the original prompt: *"Assume role of a expert stock market analyzer. Create a report on PowerGrid stock based on its price movement in past 2-3 months. I would like to see the candlestick chart with other indicators. Your task is also to analyze the stock price movement and correlate with news, and provide a final conclusion with reasoning on buy, hold or sell."*
   - Watch the tool calls in the chat sidebar. Confirm:
     - `artifact_create` is called once for the canonical artifact (e.g. `powergrid-stock-analysis`); subsequent calls return `status: "already_exists"` with the same id and the model picks up the hint.
     - The first `execute_command` that runs `python` / `pip` includes `python_venv: ".data/.venv"` in the result. If `.data/.venv` was missing, also `python_venv_lazy_created: true` on the first call only.
     - If the model uses `pip_install`, `.data/requirements.txt` gains the new package(s) — check with `cat .data/requirements.txt`.
     - `which python` and `which pip` from inside `execute_command` resolve to `.data/.venv/bin/...`.

4. **Final dir count.** After the prompt completes:

   ```bash
   ls /srv/work/sahayak/.data/AAft3EmyUcIT/yeF_e5rr-YQe/artifacts/ | wc -l
   ```

   Expected: a small handful (1-3) instead of 94. If the model creates more than ~5, the dedup heuristic isn't catching the variations the model is using — file as a follow-up.

---

## Self-review

**1. Spec coverage**

| Spec section | Implemented in | Status |
| --- | --- | --- |
| §1 artifact_create dedup (explicit id + slug-prefix match) | Task 2 | ✅ |
| §2 .data/.venv layout + .data/requirements.txt | Task 1 (constants), Task 5 (creation) | ✅ |
| §3 Eager creation via setup-python.mjs | Task 5 | ✅ |
| §4 Lazy creation in execute_command | Task 3 (`ensureDataVenv` helper) | ✅ |
| §5 Auto-prefix in execute_command | Task 3 (`applyVenvPrefix` + handler integration) | ✅ |
| §6 pip_install tool | Task 3 (spec) + Task 4 (registration) | ✅ |
| §7 System prompt addition | Task 6 | ✅ |
| §8 paths.ts constants | Task 1 | ✅ |

**2. Placeholder scan:** no "TBD"/"TODO"/"add appropriate" patterns. Every step shows actual code or commands. The pip-install package-name extraction regex (`/[=<>!~\[]/`) is explicitly noted as the boundary character set.

**3. Type consistency:** `DATA_VENV_DIR`, `DATA_VENV_PYTHON`, `DATA_VENV_PIP`, `DATA_REQUIREMENTS_FILE`, `DATA_DIR` — names used consistently across all tasks. The `ensureDataVenv` return type `{ created: boolean }` is consumed identically in `executeCommand` and `pipInstall`. The new tool result fields (`python_venv`, `python_venv_lazy_created`, `installed`, `requirements_path`) are camelCase-then-snake-case mixed because that matches the existing tool-result conventions (`stdout`, `stderr`, `exit_code`).

**Off-spec but pragmatic additions:**
- The seed `DEFAULT_REQUIREMENTS` constant is duplicated in `shell.ts` (`ensureDataVenv`'s seed-on-lazy-create path) AND `setup-python.mjs` (eager creation path). Acceptable because the two files run in different contexts (Next.js TypeScript vs. plain Node ESM script) and a shared module would add complexity without clear benefit. Worth a comment in each location pointing to the other so they don't drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-artifact-dedup-and-python-venv.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for the 6-task sweep with two non-trivial edits (Tasks 2 + 3).

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints. Faster end-to-end but no per-task review pass.

Which approach?

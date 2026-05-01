# Artifact-mode reliability: artifact_create dedup + project Python venv

**Date:** 2026-04-30
**Scope:** Two intertwined fixes to make artifact-mode usable for real data work. (1) Server-side dedup in `artifact_create` so iterative refinement doesn't accrete dozens of junk artifact dirs per prompt. (2) Project-managed Python venv at `.data/.venv` with auto-prefixed Python invocations and a `pip_install` tool that maintains `.data/requirements.txt`. Out of scope: changing the existing `python/.venv` (Sahayak's doc-parser venv); cleanup of pre-existing junk artifact dirs (one-shot manual rm); per-artifact venvs.

## Problem

A real-world prompt — *"Assume role of a expert stock market analyzer. Create a report on PowerGrid stock based on its price movement in past 2-3 months. I would like to see the candlestick chart with other indicators. Your task is also to analyze the stock price movement and correlate with news, and provide a final conclusion with reasoning on buy, hold or sell."* — produced **94 artifact directories** in a single session and a `pip install yfinance` to the global Python.

Two independent root causes:

1. **`artifact_create` has no dedup.** [src/lib/tools/artifact.ts:60](src/lib/tools/artifact.ts#L60) generates `${slug}-${nanoid(8)}` when `id` is omitted (fresh id every call), and `fs.mkdir(..., recursive: true)` silently succeeds when an explicit id is reused. Either way the model gets `ok()` and assumes a new artifact. Iterative refinement ("now add a moving average… try a different style…") creates a new artifact per turn instead of overwriting. Mirrors the memory-loop pathology fixed earlier on this branch.
2. **No project Python venv.** `execute_command` runs `bash -lc <cmd>` against whatever `python` / `pip` is on PATH. The user's procedural memory specifying `~/.sahayak/python_code/.venv` (a) is a `procedural` type and so isn't always-injected, and (b) didn't surface via auto-recall because the cosine query (*"expert stock market analyzer..."*) was nowhere near the procedural's vocabulary. Net result: the model installed yfinance globally.

## Goal

Iterative artifact-mode prompts that involve Python data work converge on a single artifact and use a project-isolated Python environment that grows a tracked requirements file as the model needs new packages.

## Non-goals

- Cleaning the existing 94 stale dirs from the user's session — out of band, one-shot manual rm.
- Touching `python/.venv` (the existing doc-parser venv at the repo root). It serves a different purpose (install-time dep for officeparser/encrypted PDFs); leave it alone.
- Per-artifact or per-session venvs. One project-wide venv at `.data/.venv` is enough.
- A general-purpose `python_run` tool. Auto-prefix in `execute_command` covers run-time; only the install/record half needs a dedicated tool (`pip_install`).
- A web UI to manage `.data/requirements.txt`. The user is welcome to edit it by hand.
- Tearing down `.data/.venv` on session delete. The venv lives one level above sessions; session-cleanup already handles `.data/<aid>/<sid>/` and shouldn't touch the project venv.

## Design

### 1. `artifact_create` dedup

`src/lib/tools/artifact.ts` gains a dedup branch that mirrors the `remember` tool's behavior. Pseudocode:

```
existing = list of artifact ids in this session
                (read from artifactsDir(scope) directory entries)

if args.id provided and validId(args.id):
    if existing contains args.id:
        return ok({
            status: "already_exists",
            id: args.id,
            files_path,
            hint: "Update the same artifact by writing files here and re-emitting the same id in your fence.",
        })
    // else fall through to create with the model's chosen id
else:
    candidate = slugify(args.title or "artifact")
    for each existing id:
        if existing equals candidate, OR existing starts with candidate + "-":
            return ok({
                status: "already_exists",
                id: existing,
                files_path,
                hint: ..., (same as above)
            })
    // else generate fresh: <candidate>-<nanoid8>

create dir, return ok({ status: "created", id, files_path, hint })
```

The model gets the existing id back and the hint nudges it to reuse. Even if it doesn't internalize the lesson, the same dir is written to twice — no junk accretion.

The `validId` regex (`^[a-z0-9][a-z0-9-]{0,80}$`) and the slugify helper stay as today. Filesystem listing of existing artifacts is cheap (one `readdir` on `artifactsDir(scope)`); for a typical session this is tens of entries at most.

### 2. Project Python venv layout

- `.data/.venv/` — Python virtual environment created by `python3 -m venv`.
- `.data/requirements.txt` — package list, seeded with the D2 bundle and grown over time.

Both gitignored under the existing `.data/` rule.

The existing `python/.venv` at the repo root stays exactly as-is — it's for Sahayak's internal officeparser deps and has a different lifecycle (install-time fixed; tracked under `python/requirements.txt`).

### 3. Eager creation via `npm run setup:python`

Extend [scripts/setup-python.mjs](scripts/setup-python.mjs) to also create `.data/.venv` after the existing `python/.venv` block:

```
After the existing "✓ done" line:

if !existsSync(DATA_VENV):
    print "  creating data virtualenv at .data/.venv"
    run python3 -m venv .data/.venv
    print "  upgrading pip"
    run .data/.venv/bin/python -m pip install --quiet --upgrade pip

if !existsSync(DATA_REQ):
    print "  seeding .data/requirements.txt with default bundle"
    write .data/requirements.txt with the D2 lines

print "  installing data requirements"
run .data/.venv/bin/python -m pip install --quiet -r .data/requirements.txt
```

The D2 bundle:

```
pandas
numpy
requests
yfinance
matplotlib
```

Each on its own line. Sorted alphabetically. The script is idempotent — re-running on an existing venv does the upgrade-pip + install-requirements steps but doesn't recreate the venv.

### 4. Lazy creation in `execute_command`

If the model invokes Python before `npm run setup:python` has run, `execute_command` lazy-creates the venv. Add a small helper at the top of the handler:

```
async function ensureDataVenv(): Promise<{ created: boolean }> {
  if (existsSync(DATA_VENV_PYTHON)) return { created: false };
  // Run python3 -m venv .data/.venv && pip install -r .data/requirements.txt
  // Seed .data/requirements.txt if missing.
  // Return { created: true } so the caller can surface a one-line note.
}
```

`ensureDataVenv` is called from `execute_command` only when the auto-prefix logic (next section) detects a Python invocation. Otherwise it's a no-op. First-call latency is real (~30s for the D2 install), but only happens once per repo.

### 5. Auto-prefix in `execute_command`

Before passing `cmd` to bash, `execute_command` parses the leading token of each shell-segment (split on `&&`, `||`, `;`, `|`) and rewrites:

| Original first token | Rewritten to |
| --- | --- |
| `python` | `<repo>/.data/.venv/bin/python` |
| `python3` | `<repo>/.data/.venv/bin/python` |
| `pip` | `<repo>/.data/.venv/bin/pip` |
| `pip3` | `<repo>/.data/.venv/bin/pip` |

Only the literal first token is rewritten — `echo "use python to run this"` stays untouched. Anchored on `^` of each segment after stripping leading whitespace.

If the auto-prefix fires and the venv doesn't exist, the helper from §4 runs first.

The rewrite is logged in the tool result as a small note: `python_venv: ".data/.venv"` (or omitted if no rewrite happened) so the model can see the policy in action.

### 6. `pip_install` tool

New tool, lives next to `execute_command` in `src/lib/tools/shell.ts` (same file — one cohesive group).

```
{
  name: "pip_install",
  group: "shell",
  description:
    "Install one or more Python packages into the project's .data/.venv AND " +
    "append them to .data/requirements.txt so the dependency persists. " +
    "Prefer this over `pip install` in execute_command — it keeps the " +
    "requirements file in sync with what's installed.",
  parameters: {
    type: "object",
    properties: {
      packages: {
        type: "string",
        description:
          "One or more pip package specs separated by spaces, e.g. " +
          "\"yfinance pandas\" or \"requests==2.31.0\"."
      }
    },
    required: ["packages"]
  },
  async handler(args) {
    // 1. ensureDataVenv()
    // 2. Run .data/.venv/bin/pip install <packages>
    // 3. On success: parse package names (drop versions, drop extras),
    //    read .data/requirements.txt, merge, sort, dedupe, write.
    // 4. Return { installed: [<names>], requirements_path: ".data/requirements.txt", upgraded: <bool> }
  }
}
```

The handler is small (~40 lines including the requirements.txt merge). Append-and-sort, not insert-at-position; comments in requirements.txt would be lost on rewrite, but the file is plain `package==version` lines today and we'll keep it that way.

### 7. System prompt addition

Inside `REACT_ARTIFACT_INSTRUCTIONS` in [src/lib/store.ts](src/lib/store.ts), insert this paragraph between the existing `Data pipeline for artifacts` block and the `External images:` block (so it's part of the compute-heavy artifact context where Python work happens):

```
Python execution
- All `python` / `pip` invocations in execute_command auto-resolve to the
  project's .data/.venv. You don't need to source-activate; just write
  `python script.py` or `pip install pandas` as normal.
- To add a new package, prefer `pip_install({packages: "X"})` — it both
  installs into the venv AND appends X to .data/requirements.txt so the
  dependency persists. Plain `pip install X` works but won't update the
  requirements file.
- Pre-installed: pandas, numpy, requests, yfinance, matplotlib.
- Do NOT use sudo, system pip, or global pip — they're never needed
  here, and a leaked global install is confusing later.
```

Don't repeat this in the GENERAL or SOFTWARE_ENGINEER prompts — the venv is universal but the explicit instruction belongs in the artifact-mode block where compute happens. Models running outside artifact mode also get auto-prefix (the `execute_command` rewrite is unconditional), they just don't get the prompt-side narration.

### 8. `paths.ts` constants

[src/lib/paths.ts](src/lib/paths.ts) gains:

```
export const DATA_VENV_DIR = path.join(DATA_DIR, ".venv");
export const DATA_VENV_PYTHON = path.join(DATA_VENV_DIR, "bin", "python");
export const DATA_VENV_PIP = path.join(DATA_VENV_DIR, "bin", "pip");
export const DATA_REQUIREMENTS_FILE = path.join(DATA_DIR, "requirements.txt");
```

Windows path variants (`Scripts\python.exe`) are NOT included for v1 — Sahayak runs on Linux/macOS. If a Windows user shows up, the path constants gain a `process.platform === "win32"` switch then.

## What changes, file by file

- **`src/lib/tools/artifact.ts`** — `artifact_create` handler gains the dedup branch (§1). ~25 lines added.
- **`src/lib/tools/shell.ts`** — `execute_command` gains the `ensureDataVenv` + auto-prefix helpers (§4, §5), plus the new `pip_install` tool spec (§6). ~80 lines added.
- **`src/lib/tools/index.ts`** — register `pipInstall` in `ALL_TOOLS`.
- **`src/lib/paths.ts`** — four new path constants (§8).
- **`scripts/setup-python.mjs`** — extend with the `.data/.venv` block (§3). ~30 lines added.
- **`src/lib/store.ts`** — insert the Python-execution paragraph into `REACT_ARTIFACT_INSTRUCTIONS` (§7). ~12 lines added.

No changes to settings, UI, chat route, or the artifact iframe.

## Risks and trade-offs

- **Auto-prefix is fragile to weird commands.** A command like `for f in *.py; do python $f; done` would hit the `for` token first, not `python`, so the inner `python` wouldn't be rewritten. Acceptable: such a command is unlikely from the model in practice; the prompt language nudges it toward simpler `python script.py` invocations. If we ever hit this in real usage, extend the parser.
- **`pip_install` exists alongside `execute_command pip install`.** Two paths to install. Auto-prefix means both go to the venv, but only `pip_install` updates `requirements.txt`. The system prompt nudges toward the dedicated tool; over time the model learns from the tool descriptions.
- **`.data/.venv` ~150 MB.** One-time cost in the user's data dir, gitignored. Acceptable; `.data/` is already where bulky session content lives.
- **First Python invocation is slow** if `npm run setup:python` was skipped. ~30-60s lazy-create cost. Acceptable — the tool result includes a note explaining what happened.
- **Dedup may surprise the model when it intentionally wants two artifacts on the same topic.** If it calls `artifact_create({title: "powergrid stock analysis"})` twice in the same session intending two separate artifacts, the second returns the first. Mitigation: model can pass distinct explicit ids (`powergrid-summary` vs `powergrid-dashboard`) to bypass slug-match. The hint in the dedup result educates the model on this.
- **Slug-prefix match could over-match.** "powergrid-summary" and "powergrid-summary-v2" would both match a "powergrid-summary" prefix. Acceptable — the existing artifact gets reused, which is what we want.

## Verification

There is no test suite; verify manually on a clean session:

1. **Setup script.** `rm -rf .data/.venv .data/requirements.txt`. Run `npm run setup:python`. Confirm `.data/.venv/bin/python` and `.data/requirements.txt` (with the 5 D2 lines) exist.
2. **Auto-prefix.** Send an artifact-mode chat with `execute_command "which python && which pip"`. Confirm both resolve to `.data/.venv/bin/...`.
3. **`pip_install`.** Use the tool surface (or via the model) to install a package not in D2 (e.g. `seaborn`). Confirm `.data/.venv/bin/pip list` shows it AND `.data/requirements.txt` has a `seaborn` line at the right alphabetical position.
4. **Lazy create.** `rm -rf .data/.venv`. Send a python execute_command. Confirm the venv is created on the fly with a tool-result note like `python_venv_lazy_created: true`.
5. **Artifact dedup, explicit id.** Run a fresh artifact-mode prompt that creates `artifact_create({id: "test-x"})` twice. Second call returns `status: "already_exists"` with the same id; only one dir at `.data/<aid>/<sid>/artifacts/test-x/`.
6. **Artifact dedup, slug match.** Run `artifact_create({title: "Stock Analysis"})` then `artifact_create({title: "Stock Analysis"})`. Second returns the first's id. Only one dir on disk.
7. **End-to-end stock prompt.** Repeat the user's PowerGrid prompt from scratch. Confirm exactly one artifact dir on disk afterward (vs the 94 from the previous session).

## Open items intentionally deferred

- Pre-existing 94 stale artifact dirs in `.data/AAft3EmyUcIT/yeF_e5rr-YQe/artifacts/` — manual cleanup, separate from this spec.
- Per-package version pinning in `pip_install` (currently appends bare names; pinned specs like `requests==2.31.0` are accepted but the version isn't extracted into requirements.txt).
- Windows path variants in paths.ts.
- Surfacing requirements.txt diff in the chat UI (the model just gets the list back via tool result).
- `pip uninstall` tool (YAGNI; user can edit requirements.txt and rerun setup).

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

/** In-flight venv setup, shared across concurrent callers so we don't
 *  race two `python3 -m venv` invocations against the same target. */
let venvSetupPromise: Promise<{ created: boolean }> | null = null;

/** Lazy-create .data/.venv on first Python invocation if the user
 *  skipped `npm run setup:python`. Returns whether we created it,
 *  so the caller can surface a one-line note. */
async function ensureDataVenv(): Promise<{ created: boolean }> {
  if (existsSync(DATA_VENV_PYTHON)) return { created: false };
  if (venvSetupPromise) return venvSetupPromise;
  venvSetupPromise = (async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    if (!existsSync(DATA_REQUIREMENTS_FILE)) {
      await fs.writeFile(
        DATA_REQUIREMENTS_FILE,
        DEFAULT_REQUIREMENTS.join("\n") + "\n",
      );
    }
    await pexec("python3", ["-m", "venv", DATA_VENV_DIR], {
      timeout: 60_000,
    });
    await pexec(DATA_VENV_PYTHON, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"], {
      timeout: 120_000,
    });
    await pexec(
      DATA_VENV_PYTHON,
      ["-m", "pip", "install", "--quiet", "-r", DATA_REQUIREMENTS_FILE],
      { timeout: 600_000 },
    );
    return { created: true };
  })().finally(() => {
    // Clear on completion (success or fail) so retries can run after a
    // fix. The existsSync guard on the next call catches the success
    // case so we don't redo the install.
    venvSetupPromise = null;
  });
  return venvSetupPromise;
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
    const m = part.match(/^(\s*)(\S+)([\s\S]*)$/);
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

/** Serializes read-modify-write of .data/requirements.txt across
 *  concurrent pip_install calls so one merge can't clobber another. */
let requirementsWriteChain: Promise<void> = Promise.resolve();

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

      // Chain the requirements.txt rewrite so concurrent pip_install
      // calls don't race the read-modify-write.
      const writePromise = requirementsWriteChain.then(async () => {
        let current: string[] = [];
        if (existsSync(DATA_REQUIREMENTS_FILE)) {
          const raw = await fs.readFile(DATA_REQUIREMENTS_FILE, "utf8");
          current = raw.split("\n").map((l) => l.trim()).filter(Boolean);
        }
        const merged = Array.from(new Set([...current, ...installed])).sort();
        await fs.writeFile(DATA_REQUIREMENTS_FILE, merged.join("\n") + "\n");
      });
      // Update the chain BEFORE awaiting so the next caller queues behind
      // us. .catch noop so a single failure doesn't poison the chain
      // for subsequent calls.
      requirementsWriteChain = writePromise.catch(() => undefined);
      await writePromise;

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
        packages,
        requirements_path: DATA_REQUIREMENTS_FILE,
        exit_code: ex.code ?? -1,
        stdout: (ex.stdout ?? "").slice(0, 64 * 1024),
        stderr: (ex.stderr ?? ex.message ?? "").slice(0, 64 * 1024),
      };
    }
  },
};

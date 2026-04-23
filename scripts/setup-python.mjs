#!/usr/bin/env node
/**
 * One-shot Sahayak Python extractor setup.
 *
 *   npm run setup:python
 *
 * - Checks that python3 is on PATH (prints a friendly hint if not).
 * - Creates ./python/.venv using Python's built-in `venv` module.
 * - Upgrades pip + installs python/requirements.txt.
 *
 * All state lives under ./python/ — nothing touches ./src/. Users who
 * skip this step still get a working app (officeparser handles most
 * documents); they just can't open encrypted PDFs.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const PY_DIR = path.join(ROOT, "python");
const VENV = path.join(PY_DIR, ".venv");
const REQ = path.join(PY_DIR, "requirements.txt");
const IS_WIN = process.platform === "win32";
const VENV_PY = IS_WIN
  ? path.join(VENV, "Scripts", "python.exe")
  : path.join(VENV, "bin", "python3");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: "inherit", ...opts });
    c.on("error", reject);
    c.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} → exit ${code}`));
    });
  });
}

function which(cmd) {
  const finder = IS_WIN ? "where" : "command";
  const args = IS_WIN ? [cmd] : ["-v", cmd];
  return new Promise((resolve) => {
    const c = spawn(finder, args, { stdio: "ignore", shell: true });
    c.on("error", () => resolve(false));
    c.on("close", (code) => resolve(code === 0));
  });
}

async function main() {
  console.log("→ Sahayak Python setup");

  if (!existsSync(REQ)) {
    console.error(`!! missing ${path.relative(ROOT, REQ)}`);
    process.exit(1);
  }

  const found = (await which("python3")) || (await which("python"));
  if (!found) {
    console.error(
      [
        "!! python3 not found on PATH.",
        "",
        "Install Python 3.11+ then re-run:",
        "    npm run setup:python",
        "",
        "Sahayak still runs without Python — you just won't be able to",
        "open encrypted PDFs. All other document types work via the",
        "pure-JS officeparser fallback.",
      ].join("\n"),
    );
    // Exit 0 so `npm run setup:python` doesn't break chained scripts /
    // CI / image-build pipelines when Python happens to be absent.
    process.exit(0);
  }

  const pythonCmd =
    (await which("python3")) ? "python3" : "python";

  if (!existsSync(VENV)) {
    console.log(`  creating virtualenv at python/.venv`);
    await run(pythonCmd, ["-m", "venv", VENV]);
  } else {
    console.log(`  reusing existing virtualenv at python/.venv`);
  }

  console.log("  upgrading pip");
  await run(VENV_PY, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);

  console.log("  installing requirements");
  await run(VENV_PY, ["-m", "pip", "install", "--quiet", "-r", REQ]);

  console.log("✓ done. Sahayak can now parse encrypted PDFs and rich Office files.");
}

main().catch((e) => {
  console.error(`\n!! setup failed: ${e.message}`);
  process.exit(1);
});

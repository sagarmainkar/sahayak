import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { readSettings } from "./settings";

// ── singleton state ─────────────────────────────────────────────────
let activeProcess: ChildProcess | null = null;
let activeConfig: LlamaLoadConfig | null = null;
let startTime = 0;

// ── types ───────────────────────────────────────────────────────────

export type LlamaModelInfo = {
  path: string;
  name: string;
  sizeBytes: number;
  sizeHuman: string;
  mmprojCandidates: { path: string; name: string; sizeHuman: string }[];
};

export type LlamaLoadConfig = {
  modelPath: string;
  contextSize: number;
  kvType: "f16" | "q8_0" | "q4_0";
  mmproj?: string;
  port?: number;
  ngl?: number;
  flashAttn?: boolean;
  jinja?: boolean;
  noContextShift?: boolean;
  cacheReuse?: number;
  parallel?: number;
  host?: string;
};

export type LlamaStatus = {
  running: boolean;
  pid?: number;
  endpoint?: string;
  modelName?: string;
  contextSize?: number;
  kvType?: string;
  mmproj?: string;
  uptimeMs?: number;
  error?: string;
};

export type GpuStats = {
  usedMiB: number;
  totalMiB: number;
  freeMiB: number;
};

// ── defaults ────────────────────────────────────────────────────────

const DEFAULT_LLAMA_SERVER = path.join(
  homedir(),
  ".unsloth",
  "llama.cpp",
  "llama-server",
);

const HF_CACHE = path.join(homedir(), ".cache", "huggingface", "hub");

async function getLlamaServerPath(): Promise<string> {
  try {
    const settings = await readSettings();
    if (settings.llamaServer?.path && settings.llamaServer.path.trim()) {
      return settings.llamaServer.path.trim();
    }
  } catch {
    // ignore
  }
  return process.env.LLAMA_SERVER_PATH ?? DEFAULT_LLAMA_SERVER;
}

// ── model scanner ───────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function prettyModelPath(fullPath: string): string {
  // models--org--model/snapshots/hash/filename.gguf → org--model :: filename.gguf
  return fullPath
    .replace(HF_CACHE + path.sep + "models--", "")
    .replace(/snapshots[/\\][^/\\]+[/\\]/, "  ::  ");
}

export async function scanAvailableModels(): Promise<LlamaModelInfo[]> {
  if (!existsSync(HF_CACHE)) return [];
  const models: LlamaModelInfo[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (
        (e.isFile() || e.isSymbolicLink()) &&
        e.name.endsWith(".gguf") &&
        !e.name.startsWith("mmproj")
      ) {
        try {
          const stat = await fs.stat(full);
          if (!stat.isFile()) continue;
          const dirName = path.dirname(full);
          const mmprojFiles: LlamaModelInfo["mmprojCandidates"] = [];
          try {
            const siblings = await fs.readdir(dirName, { withFileTypes: true });
            for (const s of siblings) {
              if (
                (s.isFile() || s.isSymbolicLink()) &&
                s.name.startsWith("mmproj") &&
                s.name.endsWith(".gguf")
              ) {
                const sp = await fs.stat(path.join(dirName, s.name));
                if (!sp.isFile()) continue;
                mmprojFiles.push({
                  path: path.join(dirName, s.name),
                  name: s.name,
                  sizeHuman: fmtBytes(sp.size),
                });
              }
            }
          } catch {
            // ignore
          }
          models.push({
            path: full,
            name: prettyModelPath(full),
            sizeBytes: stat.size,
            sizeHuman: fmtBytes(stat.size),
            mmprojCandidates: mmprojFiles,
          });
        } catch {
          // ignore stat errors on broken symlinks
        }
      }
    }
  }

  await walk(HF_CACHE);
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

// ── GPU stats ────────────────────────────────────────────────────────

export async function getGpuStats(): Promise<GpuStats | null> {
  return new Promise((resolve) => {
    const proc = spawn("nvidia-smi", [
      "--query-gpu=memory.used,memory.total,memory.free",
      "--format=csv,noheader,nounits",
    ]);
    let stdout = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", () => { /* ignore */ });
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const line = stdout.trim().split("\n")[0];
      if (!line) {
        resolve(null);
        return;
      }
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length < 3) {
        resolve(null);
        return;
      }
      const used = parseInt(parts[0], 10);
      const total = parseInt(parts[1], 10);
      const free = parseInt(parts[2], 10);
      if (!Number.isFinite(used) || !Number.isFinite(total)) {
        resolve(null);
        return;
      }
      resolve({ usedMiB: used, totalMiB: total, freeMiB: Number.isFinite(free) ? free : total - used });
    });
    proc.on("error", () => resolve(null));
    // timeout
    setTimeout(() => {
      try { proc.kill(); } catch { /* */ }
      resolve(null);
    }, 5000);
  });
}

// ── status / health ───────────────────────────────────────────────────

export async function getLlamaStatus(): Promise<LlamaStatus> {
  if (!activeProcess && !activeConfig) {
    // try to discover an existing server on default port
    const discovered = await discoverExistingServer();
    if (discovered) return discovered;
    return { running: false };
  }

  const endpoint = activeConfig
    ? `http://${activeConfig.host ?? "0.0.0.0"}:${activeConfig.port ?? 8080}`
    : undefined;

  const isAlive = activeProcess
    ? !activeProcess.killed && activeProcess.exitCode === null
    : false;

  if (!isAlive && activeProcess) {
    // process died
    return {
      running: false,
      error: `llama-server exited (pid ${activeProcess.pid})`,
    };
  }

  // health check via /ok
  if (endpoint) {
    try {
      const r = await fetch(`${endpoint}/ok`, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw new Error("not ok");
    } catch {
      return {
        running: isAlive,
        pid: activeProcess?.pid ?? undefined,
        endpoint,
        modelName: activeConfig ? path.basename(activeConfig.modelPath) : undefined,
        contextSize: activeConfig?.contextSize,
        kvType: activeConfig?.kvType,
        mmproj: activeConfig?.mmproj,
        uptimeMs: startTime ? Date.now() - startTime : undefined,
        error: "Server process alive but /ok not responding yet",
      };
    }
  }

  return {
    running: true,
    pid: activeProcess?.pid ?? undefined,
    endpoint,
    modelName: activeConfig ? path.basename(activeConfig.modelPath) : undefined,
    contextSize: activeConfig?.contextSize,
    kvType: activeConfig?.kvType,
    mmproj: activeConfig?.mmproj,
    uptimeMs: startTime ? Date.now() - startTime : undefined,
  };
}

async function discoverExistingServer(port = 8080): Promise<LlamaStatus | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/props`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      default_generation_settings?: { n_ctx?: number; model?: string };
      model_alias?: string;
      n_ctx?: number;
    };
    return {
      running: true,
      endpoint: `http://127.0.0.1:${port}`,
      modelName: j.model_alias ?? j.default_generation_settings?.model ?? "unknown",
      contextSize: j.default_generation_settings?.n_ctx ?? j.n_ctx ?? undefined,
    };
  } catch {
    return null;
  }
}

// ── load / spawn ────────────────────────────────────────────────────

export async function loadModel(config: LlamaLoadConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  // unload any existing
  await unloadModel();

  const binary = await getLlamaServerPath();
  if (!existsSync(binary)) {
    return { ok: false, error: `llama-server not found at ${binary}` };
  }
  if (!existsSync(config.modelPath)) {
    return { ok: false, error: `Model not found at ${config.modelPath}` };
  }

  const port = config.port ?? 8080;
  const host = config.host ?? "0.0.0.0";

  // verify port is free
  const portFree = await isPortFree(port);
  if (!portFree) {
    return { ok: false, error: `Port ${port} is already in use` };
  }

  const args: string[] = [
    "-m", config.modelPath,
    "-c", String(config.contextSize),
    "-ctk", config.kvType,
    "-ctv", config.kvType,
    "--host", host,
    "--port", String(port),
  ];

  if (config.mmproj) {
    args.push("--mmproj", config.mmproj);
  }
  if (config.ngl !== undefined) {
    args.push("-ngl", String(config.ngl));
  }
  if (config.flashAttn !== false) {
    args.push("-fa", "on");
  }
  if (config.jinja !== false) {
    args.push("--jinja");
  }
  if (config.noContextShift !== false) {
    args.push("--no-context-shift");
  }
  if (config.cacheReuse !== undefined) {
    args.push("--cache-reuse", String(config.cacheReuse));
  }
  if (config.parallel !== undefined) {
    args.push("--parallel", String(config.parallel));
  }

  const proc = spawn(binary, args, {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  activeProcess = proc;
  activeConfig = config;
  startTime = Date.now();

  // log to console for debugging
  proc.stdout?.on("data", (d) => {
    console.log("[llama-server]", d.toString().trimEnd());
  });
  proc.stderr?.on("data", (d) => {
    console.error("[llama-server]", d.toString().trimEnd());
  });

  proc.on("exit", (code) => {
    console.log("[llama-server] exited with code", code);
    if (activeProcess === proc) {
      activeProcess = null;
      startTime = 0;
    }
  });

  // wait a moment for the server to come up, then health-check
  await new Promise((r) => setTimeout(r, 800));
  try {
    const r = await fetch(`http://127.0.0.1:${port}/ok`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error("not ok");
  } catch {
    // server may still be loading; don't fail immediately
  }

  return { ok: true };
}

// ── unload / kill ───────────────────────────────────────────────────

export async function unloadModel(): Promise<{ killed: boolean; external: boolean }> {
  if (!activeProcess) {
    // if there is an externally-started server we can't kill it
    const discovered = await discoverExistingServer();
    return { killed: false, external: !!discovered };
  }
  const pid = activeProcess.pid;
  activeProcess.kill("SIGTERM");
  // grace period
  await new Promise((r) => setTimeout(r, 500));
  if (!activeProcess.killed && pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
  activeProcess = null;
  activeConfig = null;
  startTime = 0;
  return { killed: true, external: false };
}

// ── helpers ─────────────────────────────────────────────────────────

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => {
      s.close(() => resolve(true));
    });
    s.listen(port, "127.0.0.1");
  });
}

// ── KV cache estimator (for UI labels) ──────────────────────────────

export function estimateKvMb(contextSize: number, kvType: "f16" | "q8_0" | "q4_0"): number {
  // Rough per-token KV size for a 27B-class GQA-8 model:
  // f16 ~64KB/token, q8_0 ~32KB/token, q4_0 ~16KB/token
  const bytesPerToken =
    kvType === "f16" ? 64 * 1024 : kvType === "q8_0" ? 32 * 1024 : 16 * 1024;
  return Math.round((contextSize * bytesPerToken) / (1024 * 1024));
}

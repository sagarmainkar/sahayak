"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Cpu,
  Zap,
  Eye,
  HardDrive,
  Activity,
  Play,
  Square,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  Layers,
  Settings2,
  Server,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ── types matching API ──────────────────────────────────────────────

type GpuStats = {
  usedMiB: number;
  totalMiB: number;
  freeMiB: number;
};

type LlamaStatus = {
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

type LlamaModelInfo = {
  path: string;
  name: string;
  sizeBytes: number;
  sizeHuman: string;
  mmprojCandidates: { path: string; name: string; sizeHuman: string }[];
};

type LoadConfig = {
  modelPath: string;
  contextSize: number;
  kvType: "f16" | "q8_0" | "q4_0";
  mmproj?: string;
  port: number;
  ngl: number;
  flashAttn: boolean;
  jinja: boolean;
  noContextShift: boolean;
  cacheReuse: number;
  parallel: number;
};

// ── constants ─────────────────────────────────────────────────────

const CONTEXT_OPTIONS = [
  { value: 16384, label: "16K" },
  { value: 32768, label: "32K" },
  { value: 49152, label: "48K" },
  { value: 65536, label: "64K" },
  { value: 102400, label: "100K" },
  { value: 131072, label: "128K" },
  { value: 153600, label: "150K" },
  { value: 204800, label: "200K" },
  { value: 256000, label: "256K" },
];

const KV_OPTIONS: { value: LoadConfig["kvType"]; label: string; desc: string }[] = [
  { value: "f16", label: "16-bit", desc: "lossless reference, largest" },
  { value: "q8_0", label: "8-bit", desc: "near-lossless, recommended" },
  { value: "q4_0", label: "4-bit", desc: "smallest, ~4× less KV memory than f16" },
];

// ── helpers ─────────────────────────────────────────────────────────

function estimateKvMb(ctx: number, kv: LoadConfig["kvType"]): number {
  const bytesPerToken =
    kv === "f16" ? 64 * 1024 : kv === "q8_0" ? 32 * 1024 : 16 * 1024;
  return Math.round((ctx * bytesPerToken) / (1024 * 1024));
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function vramPercent(gpu: GpuStats): number {
  return Math.min(100, Math.round((gpu.usedMiB / gpu.totalMiB) * 100));
}

// ── component ───────────────────────────────────────────────────────

export function LlamaDashboard() {
  const [status, setStatus] = useState<LlamaStatus | null>(null);
  const [gpu, setGpu] = useState<GpuStats | null>(null);
  const [models, setModels] = useState<LlamaModelInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const [config, setConfig] = useState<LoadConfig>({
    modelPath: "",
    contextSize: 32768,
    kvType: "q8_0",
    port: 8080,
    ngl: 999,
    flashAttn: true,
    jinja: true,
    noContextShift: true,
    cacheReuse: 0,
    parallel: 1,
  });

  const [selectedModel, setSelectedModel] = useState<LlamaModelInfo | null>(null);

  // fetch user settings defaults once
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { settings: { llamaServer?: { defaults?: LoadConfig } } }) => {
        const defs = d.settings?.llamaServer?.defaults;
        if (defs) {
          setConfig((c) => ({
            ...c,
            contextSize: defs.contextSize ?? c.contextSize,
            kvType: defs.kvType ?? c.kvType,
            port: defs.port ?? c.port,
            ngl: defs.ngl ?? c.ngl,
            flashAttn: defs.flashAttn ?? c.flashAttn,
            jinja: defs.jinja ?? c.jinja,
            noContextShift: defs.noContextShift ?? c.noContextShift,
          }));
        }
      })
      .catch(() => { /* ignore */ });
  }, []);

  // initial + polling fetch
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/llama");
      if (!r.ok) throw new Error("fetch failed");
      const d = await r.json();
      setStatus(d.status ?? null);
      setGpu(d.gpu ?? null);
      setModels(d.models ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Initial data load — the set-state-in-effect lint rule is
    // overzealous for this pattern used throughout the codebase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().finally(() => setLoading(false));
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, [refresh]);

  useEffect(() => {
    // auto-dismiss toast after 4s
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleLoad() {
    if (!config.modelPath) {
      setError("Select a model first");
      return;
    }
    setActionBusy(true);
    setError(null);
    setToast(null);
    try {
      const payload: { action: "load"; config: LoadConfig } = {
        action: "load",
        config: {
          ...config,
          mmproj: selectedModel?.mmprojCandidates.find((m) => m.path === config.mmproj)?.path,
        },
      };
      const r = await fetch("/api/llama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error ?? "Load failed");
      setStatus(d.status ?? null);
      setToast({ type: "success", message: "Model loaded" });
    } catch (e) {
      setError((e as Error).message);
      setToast({ type: "error", message: (e as Error).message });
    } finally {
      setActionBusy(false);
      await refresh();
    }
  }

  async function handleUnload() {
    setActionBusy(true);
    setError(null);
    setToast(null);
    try {
      const r = await fetch("/api/llama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unload" }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error ?? "Unload failed");
      setStatus(d.status ?? null);
      setToast({ type: "success", message: "Model unloaded" });
    } catch (e) {
      setError((e as Error).message);
      setToast({ type: "error", message: (e as Error).message });
    } finally {
      setActionBusy(false);
      await refresh();
    }
  }

  const kvEstimate = estimateKvMb(config.contextSize, config.kvType);
  const gpuBarColor =
    gpu && vramPercent(gpu) > 90
      ? "bg-red-500"
      : gpu && vramPercent(gpu) > 70
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <Server className="h-4 w-4 text-accent" />
            <span className="byline">Local inference</span>
          </div>
          <h1
            className="font-display text-[30px] italic leading-[1.05] text-fg sm:text-[40px] sm:leading-none"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
          >
            Model loader
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setLoading(true);
              refresh().finally(() => setLoading(false));
            }}
            disabled={loading}
            className="tt flex items-center gap-1 rounded border border-border px-2.5 py-1.5 font-sans text-[10.5px] text-fg-muted hover:border-accent hover:text-fg disabled:opacity-40"
            data-tip="Refresh"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded border border-red-300/40 bg-red-500/10 px-4 py-2.5 font-mono text-[11.5px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Operation toast */}
      {toast && (
        <div
          className={cn(
            "mb-4 flex items-center gap-2 rounded border px-4 py-2.5 font-sans text-[12px] transition-opacity",
            toast.type === "success"
              ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : toast.type === "error"
                ? "border-red-300/40 bg-red-500/10 text-red-600 dark:text-red-400"
                : "border-blue-300/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
          )}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : toast.type === "error" ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          )}
          {toast.message}
        </div>
      )}

      {/* GPU bar */}
      <section className="mb-6 rounded-lg border border-border bg-bg-elev p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="byline flex items-center gap-1.5">
            <HardDrive className="h-3 w-3" />
            GPU memory
          </h2>
          {gpu && (
            <span className="font-mono text-[11px] text-fg-muted">
              {gpu.usedMiB.toLocaleString()} / {gpu.totalMiB.toLocaleString()} MiB
            </span>
          )}
        </div>
        {gpu ? (
          <>
            <div className="h-3 w-full overflow-hidden rounded-full bg-bg-muted">
              <div
                className={cn("h-full transition-all duration-700", gpuBarColor)}
                style={{ width: `${vramPercent(gpu)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10.5px] text-fg-subtle">
              <span>{vramPercent(gpu)}% used</span>
              <span>{gpu.freeMiB.toLocaleString()} MiB free</span>
            </div>
          </>
        ) : (
          <div className="font-serif italic text-fg-muted">
            {gpu === null ? "No GPU detected — nvidia-smi unavailable" : "Loading…"}
          </div>
        )}
      </section>

      {/* Status */}
      <section className="mb-6 rounded-lg border border-border bg-bg-elev p-5">
        <h2 className="byline mb-3 flex items-center gap-1.5">
          <Activity className="h-3 w-3" />
          Server status
        </h2>
        {status ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard
              icon={<Server className="h-3.5 w-3.5" />}
              label="State"
              value={
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px]",
                    status.running
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-fg-muted/10 text-fg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      status.running ? "bg-emerald-500" : "bg-fg-muted",
                    )}
                  />
                  {status.running ? "Running" : "Stopped"}
                </span>
              }
            />
            <StatCard
              icon={<Cpu className="h-3.5 w-3.5" />}
              label="Model"
              value={status.modelName ?? "—"}
            />
            <StatCard
              icon={<Layers className="h-3.5 w-3.5" />}
              label="Context"
              value={status.contextSize ? `${status.contextSize.toLocaleString()} tokens` : "—"}
            />
            <StatCard
              icon={<Zap className="h-3.5 w-3.5" />}
              label="KV cache"
              value={status.kvType ?? "—"}
            />
            <StatCard
              icon={<Eye className="h-3.5 w-3.5" />}
              label="Vision"
              value={status.mmproj ? pathBasename(status.mmproj) : "Disabled"}
            />
            <StatCard
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Uptime"
              value={status.uptimeMs ? fmtUptime(status.uptimeMs) : "—"}
            />
            <StatCard
              icon={<Globe className="h-3.5 w-3.5" />}
              label="Endpoint"
              value={status.endpoint ?? "—"}
              mono
            />
            <StatCard
              icon={<Settings2 className="h-3.5 w-3.5" />}
              label="PID"
              value={status.pid ? String(status.pid) : "—"}
              mono
            />
          </div>
        ) : (
          <div className="font-serif italic text-fg-muted">Loading…</div>
        )}

        {/* Unload button */}
        {status?.running && (
          <div className="mt-4">
            <button
              onClick={handleUnload}
              disabled={actionBusy}
              className="flex items-center gap-1.5 rounded-md border border-red-300/40 bg-red-500/10 px-3 py-2 font-sans text-[11.5px] text-red-600 hover:bg-red-500/20 dark:text-red-400 disabled:opacity-50"
            >
              {actionBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              {actionBusy ? "Stopping…" : "Unload model"}
            </button>
          </div>
        )}
      </section>

      {/* Load form */}
      <div className="relative">
        {actionBusy && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
            <span className="mt-2 font-sans text-[11px] text-fg-muted">{status?.running ? "Stopping server…" : "Starting server…"}</span>
          </div>
        )}
        <section
          className={cn(
            "rounded-lg border border-border bg-bg-elev p-5 transition-opacity",
            actionBusy && "opacity-50",
          )}
        >
        <h2 className="byline mb-3 flex items-center gap-1.5">
          <Play className="h-3 w-3" />
          Load model
        </h2>

        {/* Model list */}
        <div className="mb-4">
          <div className="byline mb-2">Available models</div>
          {models === null ? (
            <div className="font-serif italic text-fg-muted">Scanning…</div>
          ) : models.length === 0 ? (
            <div className="font-serif italic text-fg-muted">
              No GGUF models found in ~/.cache/huggingface/hub
            </div>
          ) : (
            <div className="max-h-56 overflow-auto rounded border border-border bg-bg-paper">
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0 bg-bg-muted/60 text-left font-mono text-[10px] uppercase tracking-[0.15em] text-fg-subtle">
                  <tr>
                    <th className="px-2 py-1">Model</th>
                    <th className="px-2 py-1 text-right">Size</th>
                    <th className="px-2 py-1 text-right">Vision projectors</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr
                      key={m.path}
                      onClick={() => {
                        setSelectedModel(m);
                        setConfig((c) => ({ ...c, modelPath: m.path, mmproj: undefined }));
                      }}
                      className={cn(
                        "cursor-pointer border-t border-border transition",
                        selectedModel?.path === m.path
                          ? "bg-accent/10"
                          : "hover:bg-bg-muted",
                      )}
                    >
                      <td className="px-2 py-1.5 font-mono text-[11px] text-fg">
                        <div className="max-w-[16rem] truncate sm:max-w-xs">{m.name}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-fg-subtle">
                        {m.sizeHuman}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-fg-subtle">
                        {m.mmprojCandidates.length > 0 ? (
                          <span className="rounded bg-bg-muted px-1 py-0.5 text-[10px]">
                            {m.mmprojCandidates.length}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedModel && (
          <div className="mb-3 rounded border border-accent/20 bg-accent/5 px-3 py-2 font-mono text-[11.5px] text-fg">
            Selected: <span className="text-accent">{selectedModel.name}</span>
            <span className="ml-2 text-fg-subtle">({selectedModel.sizeHuman})</span>
          </div>
        )}

        {/* Vision projector */}
        {selectedModel && selectedModel.mmprojCandidates.length > 0 && (
          <div className="mb-4">
            <div className="byline mb-2">Vision projector</div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setConfig((c) => ({ ...c, mmproj: undefined }))}
                className={cn(
                  "rounded border px-2.5 py-1 font-mono text-[11px] transition",
                  !config.mmproj
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-fg-muted hover:border-accent",
                )}
              >
                Text only
              </button>
              {selectedModel.mmprojCandidates.map((p) => (
                <button
                  key={p.path}
                  onClick={() => setConfig((c) => ({ ...c, mmproj: p.path }))}
                  className={cn(
                    "rounded border px-2.5 py-1 font-mono text-[11px] transition",
                    config.mmproj === p.path
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-fg-muted hover:border-accent",
                  )}
                >
                  {p.name} <span className="text-fg-subtle">({p.sizeHuman})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Context size */}
        <div className="mb-4">
          <div className="byline mb-2">Context size</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {CONTEXT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setConfig((c) => ({ ...c, contextSize: opt.value }))}
                className={cn(
                  "rounded border px-2 py-1.5 text-center font-mono text-[11px] transition",
                  config.contextSize === opt.value
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-fg-muted hover:border-accent",
                )}
              >
                <div>{opt.label}</div>
                <div className="text-[9.5px] text-fg-subtle">
                  ~{estimateKvMb(opt.value, config.kvType)} MB KV
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* KV cache precision */}
        <div className="mb-4">
          <div className="byline mb-2">KV cache precision</div>
          <div className="flex flex-wrap gap-2">
            {KV_OPTIONS.map((kv) => (
              <button
                key={kv.value}
                onClick={() => setConfig((c) => ({ ...c, kvType: kv.value }))}
                className={cn(
                  "rounded border px-3 py-2 text-left transition",
                  config.kvType === kv.value
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-accent",
                )}
              >
                <div className="font-mono text-[12px] text-fg">{kv.label}</div>
                <div className="font-serif text-[11px] italic text-fg-subtle">
                  {kv.desc}
                </div>
              </button>
            ))}
          </div>
          {config.contextSize >= 131072 && config.kvType !== "q4_0" && (
            <p className="mt-2 font-serif text-[11.5px] italic text-amber-600 dark:text-amber-400">
              Context ≥ 128K — 4-bit KV is recommended to fit VRAM.
            </p>
          )}
        </div>

        {/* Advanced */}
        <div className="mb-4">
          <button
            onClick={() => setShowAdvanced((s) => !s)}
            className="flex items-center gap-1 font-mono text-[11px] text-fg-muted hover:text-fg"
          >
            {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Advanced options
          </button>
          {showAdvanced && (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="byline">Port</span>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={config.port}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, port: Math.max(1024, Math.min(65535, Number(e.target.value) || 8080)) }))
                  }
                  className="rounded border border-border bg-bg-paper px-2 py-1 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="byline">GPU layers (-ngl)</span>
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={config.ngl}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, ngl: Math.max(0, Math.min(999, Number(e.target.value) || 0)) }))
                  }
                  className="rounded border border-border bg-bg-paper px-2 py-1 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.flashAttn}
                  onChange={(e) => setConfig((c) => ({ ...c, flashAttn: e.target.checked }))}
                  className="accent-accent"
                />
                <span className="font-mono text-[11px] text-fg">Flash attention (-fa)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.jinja}
                  onChange={(e) => setConfig((c) => ({ ...c, jinja: e.target.checked }))}
                  className="accent-accent"
                />
                <span className="font-mono text-[11px] text-fg">Jinja chat template</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.noContextShift}
                  onChange={(e) => setConfig((c) => ({ ...c, noContextShift: e.target.checked }))}
                  className="accent-accent"
                />
                <span className="font-mono text-[11px] text-fg">No context shift</span>
              </label>
            </div>
          )}
        </div>

        {/* Summary + load */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleLoad}
            disabled={actionBusy || !config.modelPath || status?.running}
            className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 font-sans text-[12px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" />
            {actionBusy ? "Loading…" : status?.running ? "Server running" : "Load model"}
          </button>
          {config.modelPath && (
            <span className="font-mono text-[10.5px] text-fg-subtle">
              {pathBasename(config.modelPath)} · {config.contextSize.toLocaleString()} ctx ·{" "}
              {config.kvType} KV (~{kvEstimate} MB)
            </span>
          )}
        </div>
      </section>
      </div>
    </main>
  );
}

// ── subcomponents ───────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-bg-paper p-3">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
        {icon}
        {label}
      </div>
      <div className={cn("text-[13px] text-fg", mono ? "font-mono" : "font-sans")}>{value}</div>
    </div>
  );
}

function pathBasename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

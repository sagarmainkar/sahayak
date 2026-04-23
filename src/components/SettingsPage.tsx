"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Settings as SettingsIcon,
  Play,
  Loader2,
  Check,
  Trash2,
  Pin,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtRelative } from "@/lib/fmt";
import type { Settings, TtsBackend } from "@/lib/settings";

type CleanupCandidate = {
  kind: "session" | "artifact";
  id: string;
  title: string;
  ageDays: number;
  sizeBytes: number;
  reason: "age" | "cascade";
};

type CleanupReport = {
  candidates: CleanupCandidate[];
  pinnedSkipped: number;
  ttlDays: number;
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type PollyVoice = {
  Id: string;
  Name: string;
  Gender: "Male" | "Female";
  LanguageCode: string;
  LanguageName: string;
};

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [voices, setVoices] = useState<PollyVoice[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupReport | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupLast, setCleanupLast] = useState<{
    when: number;
    deletedSessions: number;
    deletedArtifacts: number;
    freedBytes: number;
  } | null>(null);

  async function loadCleanup() {
    setCleanupLoading(true);
    try {
      const r = await fetch("/api/cleanup");
      if (r.ok) setCleanup(await r.json());
    } finally {
      setCleanupLoading(false);
    }
  }

  async function runCleanup() {
    if (cleanup && cleanup.candidates.length === 0) return;
    if (!confirm(`Delete ${cleanup?.candidates.length ?? 0} item(s)?`)) return;
    setCleanupRunning(true);
    try {
      const r = await fetch("/api/cleanup", { method: "POST" });
      if (r.ok) {
        const res = await r.json();
        setCleanupLast({ ...res, when: Date.now() });
        await loadCleanup();
      }
    } finally {
      setCleanupRunning(false);
    }
  }

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { settings: Settings }) => setSettings(d.settings));
    loadCleanup();
  }, []);

  useEffect(() => {
    if (settings?.tts.backend !== "polly" || voices !== null) return;
    fetch("/api/tts/polly/voices")
      .then(async (r) => {
        if (!r.ok) {
          setVoicesError((await r.json()).error ?? `status ${r.status}`);
          return;
        }
        const d = (await r.json()) as { voices: PollyVoice[] };
        setVoices(d.voices);
      })
      .catch((e) => setVoicesError((e as Error).message));
  }, [settings?.tts.backend, voices]);

  async function patchSettings(patch: Partial<Settings>) {
    const r = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const d = (await r.json()) as { settings: Settings };
    setSettings(d.settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function preview(voice: string) {
    setPreviewing(voice);
    try {
      const r = await fetch("/api/tts/polly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hello from Sahayak. This is a voice preview.",
          voice,
        }),
      });
      if (!r.ok) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener("ended", () => {
        URL.revokeObjectURL(url);
        setPreviewing(null);
      });
      audio.addEventListener("error", () => {
        URL.revokeObjectURL(url);
        setPreviewing(null);
      });
      audio.play();
    } catch {
      setPreviewing(null);
    }
  }

  const byLanguage = useMemo(() => {
    if (!voices) return [];
    const map = new Map<string, { langName: string; voices: PollyVoice[] }>();
    for (const v of voices) {
      const entry = map.get(v.LanguageCode) ?? {
        langName: v.LanguageName,
        voices: [],
      };
      entry.voices.push(v);
      map.set(v.LanguageCode, entry);
    }
    return [...map.entries()].map(([code, val]) => ({
      code,
      langName: val.langName,
      voices: val.voices,
    }));
  }, [voices]);

  if (!settings) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8 font-serif italic text-fg-muted">
        loading…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-accent" />
            <span className="byline">settings</span>
          </div>
          <h1
            className="font-display text-[30px] italic leading-[1.05] text-fg sm:text-[40px] sm:leading-none"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
          >
            Preferences
          </h1>
        </div>
        {saved && (
          <span className="flex items-center gap-1 font-sans text-[11.5px] text-emerald-500">
            <Check className="h-3.5 w-3.5" />
            saved
          </span>
        )}
      </div>

      <section className="rounded-lg border border-border bg-bg-elev p-5">
        <h2 className="byline mb-4">Text to speech</h2>

        <div className="mb-4">
          <label className="mb-2 block font-sans text-[11px] uppercase tracking-[0.1em] text-fg-subtle">
            Backend
          </label>
          <div className="flex gap-2">
            <BackendButton
              active={settings.tts.backend === "soprano"}
              onClick={() =>
                patchSettings({
                  tts: { backend: "soprano", pollyVoice: settings.tts.pollyVoice },
                })
              }
              label="Soprano"
              sublabel="local · free · 32 kHz"
            />
            <BackendButton
              active={settings.tts.backend === "polly"}
              onClick={() =>
                patchSettings({
                  tts: { backend: "polly", pollyVoice: settings.tts.pollyVoice },
                })
              }
              label="AWS Polly"
              sublabel="neural · cloud · 24 kHz"
            />
          </div>
        </div>

        {settings.tts.backend === "polly" && (
          <div>
            <label className="mb-2 block font-sans text-[11px] uppercase tracking-[0.1em] text-fg-subtle">
              Voice
            </label>
            {voicesError ? (
              <div className="rounded border border-red-500/40 bg-red-500/5 p-3 font-mono text-[11.5px] text-red-500">
                couldn&apos;t list voices — {voicesError}
              </div>
            ) : !voices ? (
              <div className="font-serif italic text-fg-muted">
                loading voices…
              </div>
            ) : (
              <div className="space-y-4">
                {byLanguage.map((grp) => (
                  <div key={grp.code}>
                    <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.15em] text-fg-subtle">
                      {grp.langName} · {grp.code}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {grp.voices.map((v) => {
                        const selected = settings.tts.pollyVoice === v.Id;
                        return (
                          <div
                            key={v.Id}
                            className={cn(
                              "flex items-center gap-2 rounded border p-2 text-[12.5px] transition",
                              selected
                                ? "border-accent bg-accent/10"
                                : "border-border hover:bg-bg-muted",
                            )}
                          >
                            <button
                              onClick={() =>
                                patchSettings({
                                  tts: {
                                    backend: "polly",
                                    pollyVoice: v.Id,
                                  },
                                })
                              }
                              className="flex-1 text-left"
                            >
                              <div className="font-mono text-fg">{v.Name}</div>
                              <div className="font-sans text-[10.5px] text-fg-subtle">
                                {v.Gender}
                              </div>
                            </button>
                            <button
                              onClick={() => preview(v.Id)}
                              disabled={previewing !== null}
                              className="tt rounded p-1 text-fg-subtle hover:text-fg disabled:opacity-40"
                              data-tip="Preview"
                            >
                              {previewing === v.Id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-bg-elev p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="byline">Storage cleanup</h2>
          <button
            onClick={loadCleanup}
            disabled={cleanupLoading}
            className="tt flex items-center gap-1 rounded border border-border px-2 py-0.5 font-sans text-[10.5px] text-fg-muted hover:border-accent hover:text-fg disabled:opacity-40"
            data-tip="Refresh"
          >
            <RefreshCw
              className={cn("h-3 w-3", cleanupLoading && "animate-spin")}
            />
            Refresh
          </button>
        </div>

        <p className="mb-3 font-serif text-[12.5px] italic text-fg-muted">
          Sessions and artifacts not updated in the last{" "}
          <span className="font-mono not-italic text-fg">
            {settings?.cleanup.ttlDays ?? cleanup?.ttlDays ?? 15}
          </span>{" "}
          days are cleaned up automatically (runs in the background ~once a
          day). Pin (
          <Pin className="inline h-3 w-3 fill-accent text-accent" />) any
          item you want to keep forever.
        </p>

        <div className="mb-3 flex items-center gap-2 text-[11.5px] text-fg-muted">
          <label htmlFor="cleanup-ttl">TTL (days)</label>
          <input
            id="cleanup-ttl"
            type="number"
            min={1}
            max={365}
            step={1}
            disabled={!settings}
            value={settings?.cleanup.ttlDays ?? 15}
            onChange={(e) => {
              const v = Math.floor(Number(e.target.value));
              if (!Number.isFinite(v)) return;
              const clamped = Math.max(1, Math.min(365, v));
              // Optimistic local update so the number reflects immediately
              // — patchSettings will replace with the server-clamped value.
              setSettings((prev) =>
                prev ? { ...prev, cleanup: { ttlDays: clamped } } : prev,
              );
            }}
            onBlur={(e) => {
              const v = Math.floor(Number(e.target.value));
              if (!Number.isFinite(v)) return;
              const clamped = Math.max(1, Math.min(365, v));
              patchSettings({ cleanup: { ttlDays: clamped } }).then(() =>
                loadCleanup(),
              );
            }}
            className="w-20 rounded border border-border bg-bg-paper px-2 py-0.5 font-mono text-fg focus:border-accent focus:outline-none"
          />
          <span className="text-fg-subtle">
            (1–365; applies to the next preview/sweep)
          </span>
        </div>

        {cleanup && (
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[11.5px] text-fg-muted">
            <span>
              <span className="font-mono text-fg">
                {cleanup.candidates.length}
              </span>{" "}
              item(s) eligible for cleanup
            </span>
            <span>·</span>
            <span>
              <span className="font-mono text-fg">
                {cleanup.pinnedSkipped}
              </span>{" "}
              pinned (kept)
            </span>
            <span>·</span>
            <span>
              TTL{" "}
              <span className="font-mono text-fg">
                {cleanup.ttlDays} days
              </span>
            </span>
          </div>
        )}

        {cleanup && cleanup.candidates.length > 0 && (
          <div className="mb-3 max-h-60 overflow-auto rounded border border-border bg-bg-paper">
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-bg-muted/60 text-left font-mono text-[10px] uppercase tracking-[0.15em] text-fg-subtle">
                <tr>
                  <th className="px-2 py-1">kind</th>
                  <th className="px-2 py-1">title</th>
                  <th className="px-2 py-1">reason</th>
                  <th className="px-2 py-1 text-right">age</th>
                  <th className="px-2 py-1 text-right">size</th>
                </tr>
              </thead>
              <tbody>
                {cleanup.candidates.map((c) => (
                  <tr
                    key={`${c.kind}-${c.id}`}
                    className="border-t border-border"
                  >
                    <td className="px-2 py-1 font-mono text-fg-subtle">
                      {c.kind}
                    </td>
                    <td className="px-2 py-1 font-serif text-fg">
                      <span className="truncate">{c.title || "—"}</span>
                    </td>
                    <td className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-subtle">
                      {c.reason === "cascade"
                        ? "session gone"
                        : `${c.ageDays}d old`}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-fg-subtle">
                      {c.ageDays}d
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-fg-subtle">
                      {fmtBytes(c.sizeBytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={runCleanup}
            disabled={
              cleanupRunning || !cleanup || cleanup.candidates.length === 0
            }
            className="flex items-center gap-1.5 rounded-md bg-red-500/90 px-3 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-red-500 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {cleanupRunning ? "Cleaning…" : "Clean now"}
          </button>
          {cleanupLast && (
            <span className="font-sans text-[11px] text-fg-muted">
              Last run {fmtRelative(cleanupLast.when)}:{" "}
              {cleanupLast.deletedSessions} session(s),{" "}
              {cleanupLast.deletedArtifacts} artifact(s),{" "}
              {fmtBytes(cleanupLast.freedBytes)} freed
            </span>
          )}
        </div>
      </section>

      <McpServersSection />
    </main>
  );
}

type McpServerSummary = {
  server: {
    id: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    enabled: boolean;
  };
  status:
    | { kind: "disconnected" }
    | { kind: "connecting" }
    | { kind: "ready"; tools: number }
    | { kind: "error"; message: string };
  tools: { name: string; description: string }[];
};

function McpServersSection() {
  const [servers, setServers] = useState<McpServerSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("npx");
  const [newArgs, setNewArgs] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/mcp");
    if (r.ok) {
      const d = (await r.json()) as { servers: McpServerSummary[] };
      setServers(d.servers);
    }
  }
  useEffect(() => {
    // Match the cleanup + load pattern used elsewhere in this file;
    // the set-state-in-effect lint rule is overzealous for an initial
    // data load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function add() {
    setBusy(true);
    setAddError(null);
    try {
      const args = newArgs
        .trim()
        .split(/\s+/)
        .filter((a) => a.length > 0);
      const r = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          command: newCommand.trim(),
          args,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setNewName("");
      setNewArgs("");
      setShowAdd(false);
      await load();
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch(`/api/mcp/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Remove this MCP server?")) return;
    await fetch(`/api/mcp/${id}`, { method: "DELETE" });
    await load();
  }

  async function reconnect(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/mcp/${id}`, { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-border bg-bg-elev p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="byline">MCP servers</h2>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="tt flex items-center gap-1 rounded border border-border px-2 py-0.5 font-sans text-[10.5px] text-fg-muted hover:border-accent hover:text-fg"
          data-tip={showAdd ? "Cancel" : "Add server"}
        >
          {showAdd ? "cancel" : "+ add"}
        </button>
      </div>

      <p className="mb-3 font-serif text-[12.5px] italic text-fg-muted">
        Register Model Context Protocol servers over stdio. Their tools
        appear in every assistant&apos;s tool picker as{" "}
        <span className="font-mono not-italic">mcp:name:tool</span>; flip
        them on per-assistant like any native tool.
      </p>

      {showAdd && (
        <div className="mb-3 flex flex-col gap-2 rounded border border-border bg-bg-paper p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex-1">
              <div className="byline mb-1">name</div>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="filesystem"
                className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
              />
            </label>
            <label className="sm:w-32">
              <div className="byline mb-1">command</div>
              <input
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
              />
            </label>
          </div>
          <label>
            <div className="byline mb-1">args (space-separated)</div>
            <input
              value={newArgs}
              onChange={(e) => setNewArgs(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem /home/ubuntu"
              className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
            />
          </label>
          {addError && (
            <div className="font-mono text-[11px] text-red-500">
              {addError}
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={add}
              disabled={busy || !newName.trim() || !newCommand.trim()}
              className="rounded bg-accent px-3 py-1 font-sans text-[11.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add server"}
            </button>
          </div>
        </div>
      )}

      {servers === null ? (
        <div className="py-4 text-center font-serif text-[12px] italic text-fg-subtle">
          loading…
        </div>
      ) : servers.length === 0 ? (
        <div className="py-4 text-center font-serif text-[12px] italic text-fg-subtle">
          no MCP servers registered yet
        </div>
      ) : (
        <div className="divide-y divide-border">
          {servers.map((s) => {
            const statusColor =
              s.status.kind === "ready"
                ? "text-emerald-600 dark:text-emerald-400"
                : s.status.kind === "error"
                  ? "text-red-600 dark:text-red-400"
                  : s.status.kind === "connecting"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-fg-subtle";
            const statusText =
              s.status.kind === "ready"
                ? `ready · ${s.status.tools} tool${s.status.tools === 1 ? "" : "s"}`
                : s.status.kind === "error"
                  ? `error · ${s.status.message.slice(0, 80)}`
                  : s.status.kind === "connecting"
                    ? "connecting…"
                    : s.server.enabled
                      ? "idle"
                      : "disabled";
            return (
              <div
                key={s.server.id}
                className="flex items-start gap-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[13px] text-fg">
                      {s.server.name}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[10.5px]",
                        statusColor,
                      )}
                    >
                      {statusText}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
                    {s.server.command} {s.server.args.join(" ")}
                  </div>
                  {s.tools.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.tools.map((t) => (
                        <span
                          key={t.name}
                          title={t.description}
                          className="rounded-sm bg-bg-muted px-1.5 py-[1px] font-mono text-[9.5px] text-fg-subtle"
                        >
                          {t.name.replace(/^mcp:[^:]+:/, "")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => reconnect(s.server.id)}
                    disabled={busy || !s.server.enabled}
                    className="tt rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg disabled:opacity-40"
                    data-tip="Reconnect + relist tools"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => toggle(s.server.id, !s.server.enabled)}
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                      s.server.enabled
                        ? "border-accent/40 text-accent"
                        : "border-border text-fg-subtle",
                    )}
                  >
                    {s.server.enabled ? "on" : "off"}
                  </button>
                  <button
                    onClick={() => remove(s.server.id)}
                    className="tt rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-red-500"
                    data-tip="Remove"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function BackendButton({
  active,
  onClick,
  label,
  sublabel,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sublabel: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 rounded border px-3 py-2.5 text-left transition",
        active
          ? "border-accent bg-accent/10"
          : "border-border hover:bg-bg-muted",
      )}
    >
      <div className="font-mono text-[13px] text-fg">{label}</div>
      <div className="font-sans text-[10.5px] text-fg-subtle">{sublabel}</div>
    </button>
  );
}

// Avoid an unused-import warning in clients that don't use this type.
export type { TtsBackend };

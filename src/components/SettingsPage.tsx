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
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-accent" />
            <span className="byline">settings</span>
          </div>
          <h1
            className="font-display text-[40px] italic leading-none text-fg"
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
          {cleanup?.ttlDays ?? 15} days are cleaned up automatically (runs
          in the background ~once a day). Pin (
          <Pin className="inline h-3 w-3 fill-accent text-accent" />) any
          item you want to keep forever.
        </p>

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
    </main>
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

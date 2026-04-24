"use client";

import { useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  Check,
  Trash2,
  Pin,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtRelative } from "@/lib/fmt";
import type { Settings } from "@/lib/settings";
import { useConfirm } from "./ConfirmDialog";

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

export function SettingsPage() {
  const confirm = useConfirm();
  const [settings, setSettings] = useState<Settings | null>(null);
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
    const n = cleanup?.candidates.length ?? 0;
    if (
      !(await confirm({
        title: "Storage cleanup",
        message: `Permanently delete ${n} session${n === 1 ? "" : "s"} and everything they contain (uploads, artifacts)?`,
        tone: "danger",
        confirmLabel: "Delete",
      }))
    )
      return;
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

      {/* Text-to-speech section removed for the open-source cut.
          /api/tts routes + src/lib/useSpeaker.ts + TTS settings type
          remain in the repo, so reverting this file is enough to
          bring the UI back. See git history for the original JSX. */}

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
              cleanupRunning ||
              cleanupLoading ||
              !cleanup ||
              cleanup.candidates.length === 0
            }
            className="flex items-center gap-1.5 rounded-md bg-red-500/90 px-3 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-red-500 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {cleanupRunning
              ? "Cleaning…"
              : cleanupLoading
                ? "Checking…"
                : !cleanup || cleanup.candidates.length === 0
                  ? "Nothing to clean"
                  : "Clean now"}
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

      <OllamaKeySection
        settings={settings}
        patchSettings={patchSettings}
      />

      <McpServersSection />
    </main>
  );
}

function OllamaKeySection({
  settings,
  patchSettings,
}: {
  settings: Settings | null;
  patchSettings: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [reveal, setReveal] = useState(false);
  // Local draft so typing doesn't wipe the saved value on re-render
  // and we can compare against what's actually on disk when saving.
  const saved = settings?.ollama.apiKey ?? "";
  const [draft, setDraft] = useState(saved);
  const [savedState, setSavedState] = useState<
    "idle" | "saving" | "done"
  >("idle");
  // If settings loads/reloads from the server and the draft is still
  // the empty default, adopt the server value. Don't clobber user edits.
  useEffect(() => {
    if (draft === "") setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  async function save() {
    const v = draft.trim();
    if (v === saved) return;
    setSavedState("saving");
    await patchSettings({ ollama: { apiKey: v } });
    setSavedState("done");
    setTimeout(() => setSavedState("idle"), 1500);
  }

  return (
    <section className="mt-6 rounded-lg border border-border bg-bg-elev p-5">
      <h2 className="byline mb-3">Ollama API key</h2>
      <p className="mb-3 font-serif text-[12.5px] italic text-fg-muted">
        Required for the hosted <span className="font-mono not-italic">web_search</span>{" "}
        and <span className="font-mono not-italic">web_fetch</span> tools.
        Create one at{" "}
        <a
          href="https://ollama.com/settings/keys"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          ollama.com/settings/keys
        </a>
        . Stored locally in{" "}
        <span className="font-mono not-italic">.config/settings.json</span>.
      </p>
      <div className="flex items-center gap-2 text-[11.5px]">
        <input
          type={reveal ? "text" : "password"}
          spellCheck={false}
          autoComplete="off"
          placeholder="paste token here"
          disabled={!settings}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          className="flex-1 rounded border border-border bg-bg-paper px-2 py-1 font-mono text-fg focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={save}
          disabled={!settings || draft.trim() === saved || savedState === "saving"}
          className="rounded border border-border bg-bg-paper px-3 py-1 font-sans text-fg hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {savedState === "saving"
            ? "Saving…"
            : savedState === "done"
              ? "Saved"
              : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          className="rounded border border-border px-2 py-1 font-sans text-fg-muted hover:border-accent hover:text-fg"
        >
          {reveal ? "Hide" : "Show"}
        </button>
      </div>
    </section>
  );
}

type McpServerSummary = {
  server: {
    id: string;
    name: string;
    transport?: "stdio" | "http";
    // stdio:
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    // http:
    url?: string;
    headers?: Record<string, string>;
    enabled: boolean;
  };
  status:
    | { kind: "disconnected" }
    | { kind: "connecting" }
    | { kind: "ready"; tools: number }
    | { kind: "error"; message: string };
  tools: { name: string; description: string }[];
};

function TransportTab({
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
      type="button"
      onClick={onClick}
      className={cn(
        "rounded border px-2.5 py-1 text-left transition",
        active
          ? "border-accent bg-accent/10"
          : "border-border hover:bg-bg-muted",
      )}
    >
      <div className="font-mono text-[11px] text-fg">{label}</div>
      <div className="font-sans text-[9.5px] text-fg-subtle">
        {sublabel}
      </div>
    </button>
  );
}

function McpServersSection() {
  const confirm = useConfirm();
  const [servers, setServers] = useState<McpServerSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addTransport, setAddTransport] = useState<"stdio" | "http">(
    "stdio",
  );
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("npx");
  const [newArgs, setNewArgs] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  /** Open the Add form pre-filled for a Zapier MCP connection. The URL
   *  shape is personal — Zapier gives each user a per-account URL of the
   *  form https://mcp.zapier.com/api/mcp/s/<token>/mcp. We drop an empty
   *  string in so the user just pastes. */
  function startZapierAdd() {
    setShowAdd(true);
    setAddTransport("http");
    setNewName("zapier");
    setNewUrl("");
    setAddError(null);
  }

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
      const payload =
        addTransport === "http"
          ? {
              transport: "http",
              name: newName.trim(),
              url: newUrl.trim(),
            }
          : {
              transport: "stdio",
              name: newName.trim(),
              command: newCommand.trim(),
              args: newArgs
                .trim()
                .split(/\s+/)
                .filter((a) => a.length > 0),
            };
      const r = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setNewName("");
      setNewArgs("");
      setNewUrl("");
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
    if (
      !(await confirm({
        message: "Remove this MCP server?",
        tone: "danger",
        confirmLabel: "Remove",
      }))
    )
      return;
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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="byline mr-auto">MCP servers</h2>
        <button
          onClick={startZapierAdd}
          className="tt flex items-center gap-1.5 rounded border border-border bg-bg-paper px-2 py-0.5 font-sans text-[10.5px] text-fg-muted hover:border-accent hover:text-fg"
          data-tip="Pre-filled form for a Zapier MCP URL"
        >
          <span className="text-[13px]">⚡</span>
          add zapier
        </button>
        <button
          onClick={() => {
            setShowAdd((v) => !v);
            setAddTransport("stdio");
          }}
          className="tt flex items-center gap-1 rounded border border-border px-2 py-0.5 font-sans text-[10.5px] text-fg-muted hover:border-accent hover:text-fg"
          data-tip={showAdd ? "Cancel" : "Add server"}
        >
          {showAdd ? "cancel" : "+ add custom"}
        </button>
      </div>

      <p className="mb-3 font-serif text-[12.5px] italic text-fg-muted">
        Register Model Context Protocol servers — either local stdio
        processes or remote HTTP endpoints (Zapier, self-hosted, etc.).
        Their tools appear in every assistant&apos;s tool picker as{" "}
        <span className="font-mono not-italic">mcp:name:tool</span>; flip
        them on per-assistant like any native tool.
      </p>

      {showAdd && (
        <div className="mb-3 flex flex-col gap-2 rounded border border-border bg-bg-paper p-3">
          <div className="flex items-center gap-1">
            <TransportTab
              active={addTransport === "stdio"}
              onClick={() => setAddTransport("stdio")}
              label="stdio"
              sublabel="local process"
            />
            <TransportTab
              active={addTransport === "http"}
              onClick={() => setAddTransport("http")}
              label="http"
              sublabel="remote URL"
            />
          </div>
          {addTransport === "stdio" ? (
            <>
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
            </>
          ) : (
            <>
              <label>
                <div className="byline mb-1">name</div>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="zapier"
                  className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                />
              </label>
              <label>
                <div className="byline mb-1 flex items-center gap-2">
                  <span>url</span>
                  {newName === "zapier" && (
                    <a
                      href="https://mcp.zapier.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[9px] lowercase tracking-wider text-accent hover:underline"
                    >
                      get your zapier mcp url ↗
                    </a>
                  )}
                </div>
                <input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://mcp.zapier.com/api/mcp/s/<token>/mcp"
                  className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                />
                <div className="mt-1 font-serif text-[11px] italic text-fg-subtle">
                  Zapier personalises the URL per account; auth lives in
                  the path so no extra headers are needed.
                </div>
              </label>
            </>
          )}
          {addError && (
            <div className="font-mono text-[11px] text-red-500">
              {addError}
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={add}
              disabled={
                busy ||
                !newName.trim() ||
                (addTransport === "stdio" && !newCommand.trim()) ||
                (addTransport === "http" && !newUrl.trim())
              }
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
                    {(s.server.transport ?? "stdio") === "http" ? (
                      <>
                        <span className="mr-1.5 rounded-sm bg-bg-muted px-1 py-[1px] text-[9px] uppercase tracking-wider">
                          http
                        </span>
                        {s.server.url}
                      </>
                    ) : (
                      <>
                        {s.server.command} {(s.server.args ?? []).join(" ")}
                      </>
                    )}
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


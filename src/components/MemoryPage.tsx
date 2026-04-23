"use client";

import { useEffect, useMemo, useState } from "react";
import { Brain, Plus, Trash2, Search, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtRelative } from "@/lib/fmt";
import { MEMORY_TYPES, type MemoryEntry, type MemoryType } from "@/lib/types";

type SearchHit = { entry: MemoryEntry; score: number };

const TYPE_LABEL: Record<MemoryType, string> = {
  fact: "Facts",
  preference: "Preferences",
  episodic: "Episodic",
  procedural: "Procedural",
  event: "Events",
  semantic: "Semantic",
};

export function MemoryPage() {
  const [memories, setMemories] = useState<MemoryEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addType, setAddType] = useState<MemoryType>("fact");
  const [addContent, setAddContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/memory");
    const d = (await r.json()) as { memories: MemoryEntry[] };
    setMemories(d.memories);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Debounced semantic search as you type.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch("/api/memory/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, limit: 10 }),
        });
        const d = (await r.json()) as { results: SearchHit[] };
        setHits(d.results);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function save() {
    const content = addContent.trim();
    if (!content) return;
    setSaving(true);
    try {
      const r = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: addType, content, source: "user" }),
      });
      if (r.ok) {
        setAddContent("");
        await refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this memory?")) return;
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function rebuild() {
    setRebuilding(true);
    setRebuildMsg(null);
    try {
      const r = await fetch("/api/memory/rebuild", { method: "POST" });
      const d = (await r.json()) as { indexed: number; skipped: number };
      setRebuildMsg(`indexed ${d.indexed} · skipped ${d.skipped}`);
      setTimeout(() => setRebuildMsg(null), 4000);
    } finally {
      setRebuilding(false);
    }
  }

  const grouped = useMemo(() => {
    const out: Record<MemoryType, MemoryEntry[]> = {
      fact: [],
      preference: [],
      episodic: [],
      procedural: [],
      event: [],
      semantic: [],
    };
    for (const m of memories ?? []) out[m.type].push(m);
    return out;
  }, [memories]);

  const totals = useMemo(() => {
    const byType = Object.fromEntries(
      MEMORY_TYPES.map((t) => [t, grouped[t].length]),
    ) as Record<MemoryType, number>;
    const total = Object.values(byType).reduce((a, b) => a + b, 0);
    return { byType, total };
  }, [grouped]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <Brain className="h-4 w-4 text-accent" />
            <span className="byline">memory</span>
          </div>
          <h1
            className="font-display text-[30px] italic leading-[1.05] text-fg sm:text-[40px] sm:leading-none"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
          >
            What I know
          </h1>
          <p className="mt-2 font-serif text-[13.5px] italic text-fg-muted">
            {totals.total} remembered across all assistants ·{" "}
            {MEMORY_TYPES.filter((t) => totals.byType[t])
              .map((t) => `${totals.byType[t]} ${t}`)
              .join(" · ") || "nothing yet"}
          </p>
        </div>
        <button
          onClick={rebuild}
          disabled={rebuilding}
          className="tt flex w-max items-center gap-1.5 self-start rounded-md border border-border px-3 py-2 font-sans text-[11.5px] text-fg-muted hover:border-accent hover:text-fg disabled:opacity-50 sm:self-auto"
          data-tip="Recompute all embeddings"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", rebuilding && "animate-spin")}
          />
          {rebuildMsg ?? (rebuilding ? "rebuilding…" : "Rebuild index")}
        </button>
      </div>

      <section className="mb-6 rounded-lg border border-border bg-bg-elev p-4">
        <h2 className="byline mb-3">add a memory</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={addType}
            onChange={(e) => setAddType(e.target.value as MemoryType)}
            className="rounded border border-border bg-bg px-2 py-2 font-mono text-[12px] focus:border-accent focus:outline-none sm:w-36"
          >
            {MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            value={addContent}
            onChange={(e) => setAddContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && addContent.trim()) save();
            }}
            placeholder="Concrete, self-contained — should make sense out of context…"
            className="flex-1 rounded border border-border bg-bg px-3 py-2 font-serif text-[14px] focus:border-accent focus:outline-none"
          />
          <button
            onClick={save}
            disabled={!addContent.trim() || saving}
            className="flex items-center justify-center gap-1.5 rounded bg-accent px-3 py-2 font-sans text-[12px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {saving ? "saving…" : "save"}
          </button>
        </div>
      </section>

      <section className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Semantic search…"
            className="w-full rounded-lg border border-border bg-bg py-2.5 pl-9 pr-4 font-serif text-[14px] focus:border-accent focus:outline-none"
          />
        </div>
        {query.trim() && (
          <div className="mt-3 rounded-lg border border-border bg-bg-paper p-3">
            <div className="byline mb-2">
              {searching
                ? "searching…"
                : hits
                  ? `${hits.length} match${hits.length === 1 ? "" : "es"}`
                  : "…"}
            </div>
            {hits && hits.length === 0 && (
              <div className="font-serif text-[13px] italic text-fg-muted">
                no matches
              </div>
            )}
            <ul className="space-y-2">
              {hits?.map((h) => (
                <li
                  key={h.entry.id}
                  className="flex items-start gap-2 rounded border border-border bg-bg px-3 py-2 sm:gap-3"
                >
                  <span className="mt-0.5 flex-shrink-0 rounded bg-bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
                    {h.entry.type}
                  </span>
                  {/* min-w-0 + break-words: lets flex-1 actually shrink
                      to viewport width and wraps long tokens inside. */}
                  <span className="min-w-0 flex-1 break-words font-serif text-[13.5px]">
                    {h.entry.content}
                  </span>
                  <span className="flex-shrink-0 font-mono text-[10.5px] tabular-nums text-fg-subtle">
                    {h.score.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {memories === null ? (
        <div className="font-serif italic text-fg-muted">loading…</div>
      ) : memories.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Brain className="mx-auto mb-3 h-6 w-6 text-fg-subtle" />
          <p className="font-display text-[16px] italic text-fg-muted">
            Nothing remembered yet.
          </p>
          <p className="mt-1 font-sans text-[11.5px] text-fg-subtle">
            Use the form above, or try <code>/remember some fact</code> in chat.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {MEMORY_TYPES.map((t) => {
            const items = grouped[t];
            if (items.length === 0) return null;
            return (
              <section key={t}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 className="font-display text-[20px] italic text-fg">
                    {TYPE_LABEL[t]}
                  </h3>
                  <span className="font-sans text-[11px] text-fg-subtle">
                    {items.length}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {items.map((m) => (
                    <li
                      key={m.id}
                      className="group flex items-start gap-2 rounded border border-border bg-bg-paper px-3 py-2 sm:gap-3"
                    >
                      {/* min-w-0 so flex-1 can actually shrink to
                          viewport width; break-words so a long URL or
                          hash in the content wraps onto the next line
                          instead of pushing the container wider. */}
                      <span className="min-w-0 flex-1 break-words font-serif text-[13.5px] leading-[1.5] text-fg">
                        {m.content}
                      </span>
                      <span
                        className={cn(
                          "flex-shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider",
                          m.source === "model"
                            ? "bg-accent/10 text-accent"
                            : "bg-bg-muted text-fg-subtle",
                        )}
                      >
                        {m.source}
                      </span>
                      {/* Relative time is a desktop nicety — hide on
                          mobile so content isn't competing with
                          metadata for the narrow row. */}
                      <span className="hidden flex-shrink-0 font-mono text-[10.5px] tabular-nums text-fg-subtle sm:inline">
                        {fmtRelative(m.updatedAt)}
                      </span>
                      <button
                        onClick={() => remove(m.id)}
                        className="tt flex-shrink-0 rounded p-1 text-fg-subtle transition-opacity hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                        data-tip="Delete"
                        aria-label="Delete memory"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

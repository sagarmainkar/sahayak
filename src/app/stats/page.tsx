"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/Header";
import { fmtTokens, fmtRelative } from "@/lib/fmt";
import type { GlobalStats } from "@/lib/analytics";

export default function StatsPage() {
  const [stats, setStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    fetch("/api/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStats);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-6 sm:mb-8">
          <div className="byline">analytics</div>
          <h1
            className="mt-1 font-display text-[30px] italic leading-[1.05] text-fg sm:text-[42px] sm:leading-none"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
          >
            What&apos;s been said
          </h1>
        </div>

        {!stats ? (
          <div className="font-serif italic text-fg-muted">loading…</div>
        ) : (
          <div className="space-y-10">
            <TotalsRow stats={stats} />
            <DailyChart stats={stats} />
            <AssistantsSection stats={stats} />
            <ModelsSection stats={stats} />
          </div>
        )}
      </main>
    </div>
  );
}

function TotalsRow({ stats }: { stats: GlobalStats }) {
  const boxes = [
    { label: "assistants", value: stats.totals.assistants.toString() },
    { label: "conversations", value: stats.totals.chats.toString() },
    { label: "tokens", value: fmtTokens(stats.totals.tokens) },
  ];
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {boxes.map((b) => (
        <div
          key={b.label}
          className="rounded-lg border border-border bg-bg-elev p-5"
        >
          <div className="byline">{b.label}</div>
          <div
            className="mt-1 font-display text-[36px] italic leading-none text-fg"
            style={{ fontVariationSettings: '"opsz" 144' }}
          >
            {b.value}
          </div>
        </div>
      ))}
    </section>
  );
}

function DailyChart({ stats }: { stats: GlobalStats }) {
  const max = Math.max(1, ...stats.days.map((d) => d.total));
  const anyActivity = stats.days.some((d) => d.total > 0);
  const assistants = Array.from(
    new Set(stats.days.flatMap((d) => Object.keys(d.byAssistant))),
  );
  const palette = [
    "var(--accent)",
    "#6366f1",
    "#10b981",
    "#f59e0b",
    "#ec4899",
    "#06b6d4",
  ];
  const colorFor = (name: string) =>
    palette[assistants.indexOf(name) % palette.length];

  return (
    <section className="rounded-lg border border-border bg-bg-elev p-5">
      <div className="mb-5 flex items-baseline justify-between">
        <h2
          className="font-display text-[20px] italic text-fg"
          style={{ fontVariationSettings: '"opsz" 120' }}
        >
          Daily volume
        </h2>
        <span className="font-sans text-[10px] uppercase tracking-[0.15em] text-fg-subtle">
          last 14 days · max {fmtTokens(max)}
        </span>
      </div>

      {!anyActivity ? (
        <div className="py-8 text-center font-serif italic text-fg-muted">
          No activity in the last 14 days.
        </div>
      ) : (
        <>
          <div className="relative flex h-44 items-end gap-2 border-b border-rule pb-1">
            {/* faint gridline at 50% */}
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-rule/60"
              aria-hidden
            />
            {stats.days.map((d) => {
              const hPct = d.total === 0 ? 0 : Math.max((d.total / max) * 100, 6);
              const parts = Object.entries(d.byAssistant).sort(
                (a, b) => b[1] - a[1],
              );
              return (
                <div
                  key={d.date}
                  className="group relative flex flex-1 flex-col items-center justify-end"
                  style={{ height: "100%" }}
                >
                  <div
                    className="flex w-full min-w-[12px] max-w-[56px] flex-col-reverse overflow-hidden rounded-sm"
                    style={{
                      height: `${hPct}%`,
                      background: d.total === 0 ? "transparent" : "var(--bg-muted)",
                    }}
                  >
                    {parts.map(([name, tokens]) => (
                      <div
                        key={name}
                        style={{
                          height: `${(tokens / d.total) * 100}%`,
                          background: colorFor(name),
                        }}
                      />
                    ))}
                  </div>
                  {d.total > 0 && (
                    <div className="pointer-events-none absolute bottom-full z-10 mb-2 hidden min-w-[160px] whitespace-pre rounded-md border border-border bg-bg-elev p-2 font-sans text-[11px] text-fg shadow-[var(--shadow)] group-hover:block">
                      <div className="font-display text-[13px] italic">
                        {d.date}
                      </div>
                      <div className="mt-0.5 text-fg-muted">
                        {fmtTokens(d.total)} total
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {parts.map(([name, tokens]) => (
                          <div
                            key={name}
                            className="flex items-center gap-1.5"
                          >
                            <span
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ background: colorFor(name) }}
                            />
                            <span className="truncate text-fg">{name}</span>
                            <span className="ml-auto font-mono tabular-nums text-fg-muted">
                              {fmtTokens(tokens)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            {stats.days.map((d) => (
              <div
                key={d.date}
                className="flex-1 text-center font-mono text-[9px] text-fg-subtle"
              >
                {d.date.slice(8)}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 border-t border-rule pt-3 font-sans text-[11px]">
            {assistants.map((name) => (
              <div
                key={name}
                className="flex items-center gap-1.5 text-fg-muted"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: colorFor(name) }}
                />
                {name}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function AssistantsSection({ stats }: { stats: GlobalStats }) {
  return (
    <section>
      <h2
        className="mb-3 font-display text-[20px] italic text-fg"
        style={{ fontVariationSettings: '"opsz" 120' }}
      >
        Assistants
      </h2>
      <div className="overflow-x-auto rounded-lg border border-border bg-bg-elev">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-muted/30 font-sans text-[10px] uppercase tracking-[0.12em] text-fg-subtle">
              <th className="p-3 text-left">name</th>
              <th className="p-3 text-left">model</th>
              <th className="p-3 text-right">chats</th>
              <th className="p-3 text-right">prompt</th>
              <th className="p-3 text-right">completion</th>
              <th className="p-3 text-right">total</th>
              <th className="p-3 text-right">last active</th>
            </tr>
          </thead>
          <tbody>
            {stats.assistants.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center font-serif italic text-fg-muted">
                  No assistants yet — go write one.
                </td>
              </tr>
            )}
            {stats.assistants.map((a) => (
              <tr
                key={a.id}
                className="border-b border-border last:border-0"
              >
                <td className="p-3">
                  <Link
                    href={`/chat/${a.id}`}
                    className="flex items-center gap-2 hover:text-accent"
                  >
                    <span
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-[13px]"
                      style={{ background: `${a.color}22`, color: a.color }}
                    >
                      {a.emoji}
                    </span>
                    <span
                      className="font-display italic"
                      style={{ fontVariationSettings: '"opsz" 120' }}
                    >
                      {a.name}
                    </span>
                  </Link>
                </td>
                <td className="p-3 font-mono text-[11px] text-fg-muted">
                  {a.model}
                </td>
                <td className="p-3 text-right font-mono tabular-nums">
                  {a.chats}
                </td>
                <td className="p-3 text-right font-mono tabular-nums text-fg-muted">
                  {fmtTokens(a.promptTokens)}
                </td>
                <td className="p-3 text-right font-mono tabular-nums text-fg-muted">
                  {fmtTokens(a.completionTokens)}
                </td>
                <td className="p-3 text-right font-mono tabular-nums font-semibold">
                  {fmtTokens(a.totalTokens)}
                </td>
                <td className="p-3 text-right font-sans text-[11px] text-fg-muted">
                  {fmtRelative(a.lastActiveAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ModelsSection({ stats }: { stats: GlobalStats }) {
  const max = Math.max(1, ...stats.models.map((m) => m.totalTokens));
  return (
    <section>
      <h2
        className="mb-3 font-display text-[20px] italic text-fg"
        style={{ fontVariationSettings: '"opsz" 120' }}
      >
        Models
      </h2>
      <div className="space-y-2 rounded-lg border border-border bg-bg-elev p-5">
        {stats.models.length === 0 && (
          <div className="font-serif italic text-fg-muted">
            No chat volume yet.
          </div>
        )}
        {stats.models.map((m) => {
          const pct = (m.totalTokens / max) * 100;
          return (
            <div key={m.name}>
              <div className="mb-1 flex items-baseline justify-between gap-2 font-sans text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-fg">{m.name}</span>
                  {m.isCloud && (
                    <span className="rounded-sm border border-border bg-bg-paper px-1 py-0.5 text-[9px] uppercase tracking-[0.12em] text-fg-subtle">
                      cloud
                    </span>
                  )}
                  {m.assistants.length > 0 && (
                    <span className="font-serif text-[11px] italic text-fg-subtle">
                      {m.assistants.join(", ")}
                    </span>
                  )}
                </div>
                <div className="font-mono tabular-nums text-fg-muted">
                  {m.chats} chats · {fmtTokens(m.totalTokens)}
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: m.isCloud ? "#8b5cf6" : "var(--accent)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

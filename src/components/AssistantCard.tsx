"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Assistant } from "@/lib/types";
import type { AssistantStats } from "@/lib/analytics";
import { fmtTokens, fmtRelative } from "@/lib/fmt";

export function AssistantCard({ a }: { a: Assistant }) {
  const [stats, setStats] = useState<AssistantStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stats/assistant/${a.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { stats: AssistantStats }) => {
        if (!cancelled) setStats(d.stats);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [a.id]);

  return (
    <Link
      href={`/chat/${a.id}`}
      className="group relative block rounded-lg border border-border bg-bg-elev p-5 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow)]"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-[22px]"
          style={{ background: `${a.color}22`, color: a.color }}
        >
          {a.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="truncate font-display text-[18px] italic leading-tight text-fg"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 40' }}
          >
            {a.name}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-fg-subtle">
            {a.model}
          </div>
        </div>
      </div>
      {a.systemPrompt && (
        <p className="mt-3 line-clamp-3 font-serif text-[13px] leading-[1.55] text-fg-muted">
          {a.systemPrompt.split("\n").find((l) => l.trim()) ??
            a.systemPrompt.slice(0, 200)}
        </p>
      )}
      <div className="mt-4 grid grid-cols-3 gap-1 border-t border-rule pt-3 font-sans text-[10px] uppercase tracking-[0.12em] text-fg-subtle">
        <div>
          <div className="font-mono text-[14px] normal-case tracking-normal text-fg">
            {stats ? stats.chats : "—"}
          </div>
          <div>chats</div>
        </div>
        <div>
          <div className="font-mono text-[14px] normal-case tracking-normal text-fg">
            {stats ? fmtTokens(stats.totalTokens) : "—"}
          </div>
          <div>tokens</div>
        </div>
        <div>
          <div className="font-mono text-[14px] normal-case tracking-normal text-fg">
            {stats ? fmtRelative(stats.lastActiveAt) : "—"}
          </div>
          <div>active</div>
        </div>
      </div>
    </Link>
  );
}

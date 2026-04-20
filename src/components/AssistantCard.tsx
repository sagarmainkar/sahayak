"use client";

import Link from "next/link";
import type { Assistant } from "@/lib/types";

export function AssistantCard({ a }: { a: Assistant }) {
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
      <div className="mt-4 flex items-center justify-between border-t border-rule pt-3 font-sans text-[10.5px] uppercase tracking-[0.12em] text-fg-subtle">
        <span>{a.enabledTools.length} tools</span>
        <span>think · {a.thinkMode}</span>
      </div>
    </Link>
  );
}

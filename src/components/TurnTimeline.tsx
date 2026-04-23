"use client";

import { useEffect, useMemo, useState } from "react";
import { Brain, Pencil, Wrench, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { TurnPhase, TurnTimeline as TTimeline } from "@/lib/types";

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 100) / 10;
  return `${s}s`;
}

function iconFor(p: TurnPhase) {
  if (p.kind === "thinking") return Brain;
  if (p.kind === "writing") return Pencil;
  return Wrench;
}

/** Group adjacent tool phases with the same name into `tool ×N` buckets
 *  for display. Keeps the underlying phase array untouched so timings
 *  remain precise. */
type DisplayItem =
  | { kind: "thinking" | "writing"; startedAt: number; endedAt?: number }
  | {
      kind: "tool";
      name: string;
      count: number;
      startedAt: number;
      endedAt?: number;
      anyFailed: boolean;
      allDone: boolean;
    };

function compact(phases: TurnPhase[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  for (const p of phases) {
    const last = out[out.length - 1];
    if (
      p.kind === "tool" &&
      last &&
      last.kind === "tool" &&
      last.name === p.name
    ) {
      last.count++;
      // Extend window: latest endedAt wins (or undefined = still open)
      if (!p.endedAt) last.endedAt = undefined;
      else if (last.endedAt && p.endedAt > last.endedAt)
        last.endedAt = p.endedAt;
      if (p.ok === false) last.anyFailed = true;
      if (!p.endedAt) last.allDone = false;
      continue;
    }
    if (p.kind === "tool") {
      out.push({
        kind: "tool",
        name: p.name,
        count: 1,
        startedAt: p.startedAt,
        endedAt: p.endedAt,
        anyFailed: p.ok === false,
        allDone: !!p.endedAt,
      });
    } else {
      out.push({ kind: p.kind, startedAt: p.startedAt, endedAt: p.endedAt });
    }
  }
  return out;
}

function itemDurationText(item: DisplayItem, now: number): string {
  const end = item.endedAt ?? now;
  return fmtDuration(end - item.startedAt);
}

/** Sum durations of non-tool phases only — that's actual model
 *  generation time (thinking + writing). Tool waits aren't part of
 *  tokens/sec. */
function generationMs(timeline: TTimeline): number {
  let total = 0;
  for (const p of timeline.phases) {
    if (p.kind === "tool") continue;
    if (p.endedAt === undefined) continue;
    total += p.endedAt - p.startedAt;
  }
  return total;
}

export function TurnTimeline({
  timeline,
  live,
  completionTokens,
}: {
  timeline: TTimeline;
  live: boolean;
  /** Total output tokens for this turn, if known. Used to render a
   *  tokens-per-second metric once the turn finishes. */
  completionTokens?: number;
}) {
  // Re-render every 500ms while the turn is live so open-phase timers
  // tick. `tick` is a wall-clock snapshot captured inside the interval so
  // render stays pure (Date.now() read from state, not called during
  // render). When `live` flips to false, the interval stops and the
  // final tick value stands as the frozen "end time" for any still-open
  // phase bars — phases closed via closeTimelineAt use their own stamp.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [live]);

  const items = useMemo(() => compact(timeline.phases), [timeline.phases]);
  if (items.length === 0 && !live) return null;

  const now = tick;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-fg-subtle">
      {items.map((it, i) => {
        const isOpen =
          it.kind === "tool" ? !it.allDone : it.endedAt === undefined;
        const Icon =
          it.kind === "tool"
            ? it.anyFailed
              ? XCircle
              : isOpen
                ? Loader2
                : CheckCircle2
            : iconFor({ kind: it.kind, startedAt: it.startedAt } as TurnPhase);
        const label =
          it.kind === "tool"
            ? it.count > 1
              ? `${it.name} ×${it.count}`
              : it.name
            : it.kind;
        return (
          <span
            key={i}
            className={cn(
              "inline-flex items-center gap-1",
              isOpen && "text-fg-muted",
              it.kind === "tool" &&
                it.anyFailed &&
                "text-red-600/80 dark:text-red-400/80",
            )}
          >
            <Icon
              className={cn(
                "h-3 w-3",
                isOpen && it.kind === "tool" && "animate-spin",
              )}
            />
            <span className="lowercase tracking-wide">{label}</span>
            <span className="text-fg-subtle/70">
              {itemDurationText(it, now)}
            </span>
            {i < items.length - 1 && (
              <span aria-hidden className="text-fg-subtle/40 pl-2">
                ·
              </span>
            )}
          </span>
        );
      })}
      {(() => {
        if (live) return null;
        if (!completionTokens) return null;
        const ms = generationMs(timeline);
        if (ms < 50) return null;
        const tps = completionTokens / (ms / 1000);
        return (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-sm border border-border/60 bg-bg-paper/60 px-1.5 py-[1px] text-[10px] text-fg-subtle"
            title={`${completionTokens} output tokens in ${(ms / 1000).toFixed(1)}s`}
          >
            <span className="tabular-nums text-fg-muted">
              {tps >= 100 ? tps.toFixed(0) : tps.toFixed(1)}
            </span>
            <span className="text-fg-subtle/70">tok/s</span>
          </span>
        );
      })()}
    </div>
  );
}

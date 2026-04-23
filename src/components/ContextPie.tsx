"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Header-bar context indicator. A small donut showing the fraction of
 * the model's context window consumed by the last recorded prompt,
 * coloured by severity (green under 60%, amber under 85%, red above).
 * Click opens a portal'd popover with numeric detail and the actions
 * that used to live beside it — Compact and Export.
 */
export function ContextPie({
  used,
  total,
  lastPrompt,
  lastCompletion,
  onCompact,
  canCompact,
  compactDisabledReason,
  exportHref,
  canExport,
}: {
  used: number;
  total: number;
  lastPrompt: number;
  lastCompletion: number;
  onCompact: () => void;
  canCompact: boolean;
  compactDisabledReason?: string;
  exportHref?: string;
  canExport: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  // Colour class names AND concrete stroke colours — CSS vars don't
  // resolve inside SVG stroke on all browsers reliably.
  const tone =
    pct < 60
      ? { ring: "rgb(16 185 129)", tw: "text-emerald-600 dark:text-emerald-400" }
      : pct < 85
        ? { ring: "rgb(245 158 11)", tw: "text-amber-600 dark:text-amber-400" }
        : { ring: "rgb(220 38 38)", tw: "text-red-600 dark:text-red-400" };

  // Donut math. r=10 gives us a 2*pi*r ≈ 62.83 circumference on a
  // 24x24 viewbox. dasharray fills the proportional arc.
  const r = 10;
  const c = 2 * Math.PI * r;
  const filled = (pct / 100) * c;

  useEffect(() => {
    if (!open) return;
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 6,
        right: Math.max(12, window.innerWidth - rect.right),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const [compacting, setCompacting] = useState(false);
  async function handleCompact() {
    if (!canCompact || compacting) return;
    setCompacting(true);
    try {
      await Promise.resolve(onCompact());
    } finally {
      setCompacting(false);
      setOpen(false);
    }
  }

  const menu =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: coords.top,
              right: coords.right,
              width: "min(18rem, calc(100vw - 1.5rem))",
            }}
            className="z-50 overflow-hidden rounded-lg border border-border bg-bg-elev shadow-[var(--shadow)]"
          >
            <div className="border-b border-border px-3.5 py-3">
              <div className="byline">context</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span
                  className={cn(
                    "font-display text-[22px] italic leading-none",
                    tone.tw,
                  )}
                  style={{ fontVariationSettings: '"opsz" 144' }}
                >
                  {pct.toFixed(0)}%
                </span>
                <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
                  {used.toLocaleString()} / {total.toLocaleString()}
                </span>
              </div>
              <div className="mt-1 font-serif text-[11.5px] italic text-fg-muted">
                auto-compacts at 70% on the next send
              </div>
            </div>
            {(lastPrompt > 0 || lastCompletion > 0) && (
              <div className="border-b border-border px-3.5 py-2.5 font-mono text-[11px] text-fg-subtle">
                <div>
                  last turn ·{" "}
                  <span className="tabular-nums text-fg-muted">
                    {lastPrompt.toLocaleString()} prompt
                  </span>
                  {" + "}
                  <span className="tabular-nums text-fg-muted">
                    {lastCompletion.toLocaleString()} completion
                  </span>
                </div>
              </div>
            )}
            <div className="flex flex-col">
              <button
                onClick={handleCompact}
                disabled={!canCompact || compacting}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-2 text-left font-sans text-[12.5px] hover:bg-bg-muted disabled:cursor-not-allowed disabled:opacity-40",
                  !canCompact && "text-fg-subtle",
                )}
                title={!canCompact ? compactDisabledReason : undefined}
              >
                {compacting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                ) : (
                  <Archive className="h-3.5 w-3.5 text-fg-muted" />
                )}
                <span>
                  {compacting
                    ? "Compacting…"
                    : canCompact
                      ? "Compact now"
                      : compactDisabledReason ?? "Can't compact"}
                </span>
              </button>
              {canExport && exportHref && (
                <a
                  href={exportHref}
                  download
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 border-t border-border px-3.5 py-2 font-sans text-[12.5px] text-fg hover:bg-bg-muted"
                >
                  <Download className="h-3.5 w-3.5 text-fg-muted" />
                  <span>Export chat as Markdown</span>
                </a>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tt flex h-7 w-7 flex-shrink-0 items-center justify-center rounded hover:bg-bg-muted"
        data-tip={`Context · ${pct.toFixed(0)}% · ${used.toLocaleString()} / ${total.toLocaleString()}`}
        aria-label="Context usage"
        aria-expanded={open}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 -rotate-90"
          aria-hidden
        >
          {/* track */}
          <circle
            cx={12}
            cy={12}
            r={r}
            fill="none"
            stroke="var(--rule)"
            strokeWidth={3}
            opacity={0.6}
          />
          {/* filled arc */}
          <circle
            cx={12}
            cy={12}
            r={r}
            fill="none"
            stroke={tone.ring}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c}`}
            style={{ transition: "stroke-dasharray 200ms ease" }}
          />
        </svg>
      </button>
      {menu}
    </>
  );
}

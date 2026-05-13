"use client";

import { useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { AlertTriangle, Code2, Copy, Check, Maximize2, X } from "lucide-react";

export function SvgBlock({ source }: { source: string }) {
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { clean, empty } = useMemo(() => {
    if (typeof window === "undefined") return { clean: "", empty: true };
    const trimmed = source.trim();
    if (!trimmed) return { clean: "", empty: true };
    const c = DOMPurify.sanitize(trimmed, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
    return { clean: String(c), empty: !c };
  }, [source]);

  const copySource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = source;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [source]);

  return (
    <>
      <div className="my-3 overflow-hidden rounded-md border border-border bg-bg-paper not-prose">
        <div className="flex items-center justify-between border-b border-border bg-bg-muted/60 px-3 py-1 font-sans text-[10.5px] uppercase tracking-[0.15em] text-fg-subtle">
          <span>svg</span>
          <div className="flex items-center gap-1">
            <button
              onClick={copySource}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-fg-subtle hover:text-fg"
              aria-label="Copy source"
            >
              {copied ? (
                <><Check className="h-3 w-3" /> copied</>
              ) : (
                <><Copy className="h-3 w-3" /> copy</>
              )}
            </button>
            {!empty && !showSource && (
              <button
                onClick={() => setExpanded(true)}
                className="flex items-center gap-1 rounded px-1 py-0.5 text-fg-subtle hover:text-fg"
                aria-label="Expand SVG"
              >
                <Maximize2 className="h-3 w-3" /> expand
              </button>
            )}
            <button
              onClick={() => setShowSource((v) => !v)}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-fg-subtle hover:text-fg"
              aria-label="Toggle source"
            >
              <Code2 className="h-3 w-3" /> {showSource ? "render" : "source"}
            </button>
          </div>
        </div>
        {showSource ? (
          <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-[1.55]">
            <code>{source}</code>
          </pre>
        ) : empty ? (
          <div className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            SVG was empty or rejected by sanitizer
          </div>
        ) : (
          <div
            className="flex items-center justify-center overflow-x-auto p-3 [&>svg]:h-auto [&>svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: clean }}
          />
        )}
      </div>

      {expanded && !empty && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] items-center justify-center overflow-auto rounded-lg border border-neutral-200 bg-white p-4 shadow-2xl sm:h-[calc(100vh-3rem)] sm:w-[calc(100vw-3rem)] sm:p-8 dark:border-neutral-700 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setExpanded(false)}
              className="absolute right-3 top-3 z-10 rounded-full bg-neutral-100 p-1.5 text-neutral-600 shadow hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <div
              className="flex h-full w-full items-center justify-center [&>svg]:h-auto [&>svg]:max-h-full [&>svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: clean }}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

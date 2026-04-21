"use client";

import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { AlertTriangle, Code2 } from "lucide-react";

export function SvgBlock({ source }: { source: string }) {
  const [showSource, setShowSource] = useState(false);

  const { clean, empty } = useMemo(() => {
    if (typeof window === "undefined") return { clean: "", empty: true };
    const trimmed = source.trim();
    if (!trimmed) return { clean: "", empty: true };
    const c = DOMPurify.sanitize(trimmed, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
    return { clean: String(c), empty: !c };
  }, [source]);

  return (
    <div className="my-3 overflow-hidden rounded-md border border-border bg-bg-paper not-prose">
      <div className="flex items-center justify-between border-b border-border bg-bg-muted/60 px-3 py-1 font-sans text-[10.5px] uppercase tracking-[0.15em] text-fg-subtle">
        <span>svg</span>
        <button
          onClick={() => setShowSource((v) => !v)}
          className="tt flex items-center gap-1 rounded px-1 py-0.5 text-fg-subtle hover:text-fg"
          data-tip="Toggle source"
        >
          <Code2 className="h-3 w-3" /> {showSource ? "render" : "source"}
        </button>
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
  );
}

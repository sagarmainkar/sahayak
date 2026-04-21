"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { AlertTriangle, Code2 } from "lucide-react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

let counter = 0;

export function MermaidBlock({ source }: { source: string }) {
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const idRef = useRef(`mermaid-${++counter}`);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);

    loadMermaid()
      .then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedTheme === "dark" ? "dark" : "default",
          securityLevel: "strict",
          fontFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
        });
        return mermaid.render(idRef.current, source.trim());
      })
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [source, resolvedTheme]);

  return (
    <div className="my-3 overflow-hidden rounded-md border border-border bg-bg-paper not-prose">
      <div className="flex items-center justify-between border-b border-border bg-bg-muted/60 px-3 py-1 font-sans text-[10.5px] uppercase tracking-[0.15em] text-fg-subtle">
        <span>mermaid</span>
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
      ) : error ? (
        // Soft fallback — render the source as a plain code block with a
        // quiet inline note rather than a scary red card. The model's
        // intent stays visible; the user isn't alarmed.
        <div>
          <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-[1.55]">
            <code>{source}</code>
          </pre>
          <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5 font-sans text-[10.5px] text-fg-subtle">
            <AlertTriangle className="h-3 w-3" />
            couldn&apos;t render as mermaid — showing source
          </div>
        </div>
      ) : svg ? (
        <div
          className="flex items-center justify-center overflow-x-auto p-3 [&>svg]:h-auto [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="p-3 font-display text-[12px] italic text-fg-muted">
          rendering…
        </div>
      )}
    </div>
  );
}

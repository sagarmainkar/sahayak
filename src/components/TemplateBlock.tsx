"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { TEMPLATES_BY_ID } from "@/lib/templates";

export function TemplateBlock({
  templateId,
  source,
  streaming = false,
}: {
  templateId: string;
  source: string;
  /** True while the parent turn is still streaming. While true, an
   *  unparseable source is shown as a "composing…" indicator (the JSON
   *  arrives a token at a time). Once streaming ends, unparseable
   *  content is surfaced as an error. */
  streaming?: boolean;
}) {
  const spec = TEMPLATES_BY_ID[templateId];
  const parsed = useMemo(() => {
    try {
      return JSON.parse(source) as unknown;
    } catch {
      return null;
    }
  }, [source]);

  if (!spec) {
    return (
      <div className="my-2 rounded-sm border border-border bg-bg-paper/60 px-3 py-2 font-mono text-[11px] text-fg-subtle">
        unknown template: <span className="text-fg">{templateId}</span>
      </div>
    );
  }

  // Don't parse-fail loudly while the model is still writing the block.
  if (parsed === null) {
    if (streaming) {
      return (
        <div className="my-2 inline-flex items-center gap-2 rounded-sm border border-border bg-bg-paper/60 px-2.5 py-1.5 font-sans text-[11.5px] text-fg-subtle">
          <Loader2 className="h-3 w-3 animate-spin" />
          composing {spec.name.toLowerCase()}…
        </div>
      );
    }
    return (
      <div className="my-2 rounded-sm border border-red-500/40 bg-red-500/5 px-3 py-2 font-mono text-[11px]">
        <div className="mb-1 text-red-600 dark:text-red-400">
          couldn&apos;t parse {spec.name} JSON
        </div>
        <pre className="whitespace-pre-wrap text-fg-subtle">{source}</pre>
      </div>
    );
  }

  const data = spec.parse(parsed);
  if (data === null) {
    if (streaming) {
      // Valid JSON but shape not yet complete — still mid-stream.
      return (
        <div className="my-2 inline-flex items-center gap-2 rounded-sm border border-border bg-bg-paper/60 px-2.5 py-1.5 font-sans text-[11.5px] text-fg-subtle">
          <Loader2 className="h-3 w-3 animate-spin" />
          composing {spec.name.toLowerCase()}…
        </div>
      );
    }
    return (
      <div className="my-2 rounded-sm border border-amber-500/40 bg-amber-500/5 px-3 py-2 font-mono text-[11px]">
        <div className="mb-1 text-amber-700 dark:text-amber-400">
          {spec.name} data didn&apos;t match the expected shape
        </div>
        <pre className="whitespace-pre-wrap text-fg-subtle">{source}</pre>
      </div>
    );
  }

  const Render = spec.Render as React.ComponentType<{ data: unknown }>;
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-fg-subtle">
        <span>↪</span>
        <span>rendered via {spec.name.toLowerCase()} template</span>
      </div>
      <Render data={data} />
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { TEMPLATES_BY_ID } from "@/lib/templates";

export function TemplateBlock({
  templateId,
  source,
}: {
  templateId: string;
  source: string;
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

  if (parsed === null) {
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
  return <Render data={data} />;
}

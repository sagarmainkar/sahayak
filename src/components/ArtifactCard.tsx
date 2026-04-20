"use client";

import { Sparkles, ExternalLink } from "lucide-react";
import { useArtifactPanel } from "./ArtifactPanelContext";

export function ArtifactCard({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const { open } = useArtifactPanel();
  return (
    <button
      onClick={() => open(id)}
      className="group my-3 flex w-full items-center gap-3 rounded-lg border border-border bg-bg-paper px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-[var(--shadow)] not-prose"
    >
      <div
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md"
        style={{
          background: "var(--accent-soft)",
          color: "var(--accent)",
        }}
      >
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="byline">artifact</div>
        <div className="truncate font-display text-[15px] italic text-fg">
          {title}
        </div>
      </div>
      <div className="flex items-center gap-1 font-sans text-[11px] text-fg-subtle group-hover:text-accent">
        open
        <ExternalLink className="h-3 w-3" />
      </div>
    </button>
  );
}

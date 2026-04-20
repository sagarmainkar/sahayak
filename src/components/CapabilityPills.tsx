"use client";

import type { ModelInfo } from "@/lib/types";

const LABELS: Record<string, { label: string; tip: string }> = {
  vision: { label: "vision", tip: "Model accepts image inputs" },
  tools: { label: "tools", tip: "Model can call tools / functions" },
  thinking: { label: "thinking", tip: "Model emits reasoning tokens" },
  completion: { label: "text", tip: "Text generation" },
};

export function CapabilityPills({ model }: { model: ModelInfo | undefined }) {
  if (!model) return null;
  const caps = (model.capabilities ?? []).filter((c) => c !== "completion");
  return (
    <div className="flex items-center gap-1">
      {caps.map((c) => {
        const info = LABELS[c] ?? { label: c, tip: c };
        return (
          <span
            key={c}
            data-tip={info.tip}
            className="tt rounded-sm border border-border bg-bg-paper px-1.5 py-0.5 font-sans text-[10px] uppercase tracking-[0.12em] text-fg-muted cursor-help"
          >
            {info.label}
          </span>
        );
      })}
    </div>
  );
}

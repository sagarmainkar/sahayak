"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LinkCard } from "./LinkCard";

export function Carousel({ urls }: { urls: string[] }) {
  const ref = useRef<HTMLDivElement>(null);

  function scroll(dir: -1 | 1) {
    const el = ref.current;
    if (!el) return;
    const dist = Math.round(el.clientWidth * 0.8) * dir;
    el.scrollBy({ left: dist, behavior: "smooth" });
  }

  if (urls.length === 0) return null;

  return (
    <div className="group relative my-4 not-prose">
      <div
        ref={ref}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2"
        style={{ scrollbarWidth: "thin" }}
      >
        {urls.map((u, i) => (
          <div
            key={i}
            className="w-72 flex-shrink-0 snap-start"
          >
            <LinkCard url={u} />
          </div>
        ))}
      </div>
      {urls.length > 1 && (
        <>
          <button
            aria-label="scroll left"
            onClick={() => scroll(-1)}
            className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full border border-border bg-bg-elev/90 p-1.5 text-fg-muted opacity-0 shadow-[var(--shadow)] backdrop-blur transition-opacity group-hover:opacity-100 hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            aria-label="scroll right"
            onClick={() => scroll(1)}
            className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full border border-border bg-bg-elev/90 p-1.5 text-fg-muted opacity-0 shadow-[var(--shadow)] backdrop-blur transition-opacity group-hover:opacity-100 hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
      <div className="byline mt-1">sources · scroll →</div>
    </div>
  );
}

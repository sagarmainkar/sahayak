"use client";

import { useState } from "react";
import { ChevronDown, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type SearchUrl = { url: string; title?: string };

function Favicon({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const domain = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();
  return (
    <img
      src={`https://www.google.com/s2/favicons?sz=64&domain=${domain}`}
      alt=""
      className={cn(
        "inline-block rounded-full border border-bg bg-bg object-contain",
        className,
      )}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

export function WebSearchBadges({
  urls,
  onSelect,
}: {
  urls: SearchUrl[];
  onSelect?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!urls.length) return null;

  const visible = urls.slice(0, 3);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-paper px-3 py-1.5 text-[11.5px] font-medium text-fg-muted transition hover:border-border-strong hover:text-fg"
      >
        <div className="flex -space-x-1.5">
          {visible.map((u, i) => (
            <Favicon key={i} url={u.url} className="h-4 w-4" />
          ))}
        </div>
        <span>
          {urls.length === 1 ? "1 Source" : `${urls.length} Sources`}
        </span>
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="mt-1.5 flex flex-col gap-0.5 rounded-lg border border-border bg-bg-paper p-2">
          {urls.map((u, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelect?.(u.url)}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-bg-muted"
            >
              <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-bg-muted text-[10px] font-medium text-fg-subtle">
                {i + 1}
              </div>
              <Favicon url={u.url} className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-fg">
                {u.title || u.url}
              </span>
              <ArrowUpRight className="h-3 w-3 flex-shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

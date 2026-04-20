"use client";

import { useEffect, useState } from "react";

type Unfurled = {
  url: string;
  title: string;
  description: string;
  image: string | null;
  favicon: string;
  domain: string;
};

const memo = new Map<string, Unfurled | null | "pending">();

export function LinkCard({ url }: { url: string }) {
  const [data, setData] = useState<Unfurled | null | "pending">(
    memo.get(url) ?? "pending",
  );

  useEffect(() => {
    if (memo.has(url) && memo.get(url) !== "pending") {
      setData(memo.get(url) ?? null);
      return;
    }
    // validate before fetching; skip malformed streaming fragments
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      new URL(url);
    } catch {
      memo.set(url, null);
      setData(null);
      return;
    }
    let aborted = false;
    fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((j: { data: Unfurled | null }) => {
        if (aborted) return;
        memo.set(url, j.data ?? null);
        setData(j.data ?? null);
      })
      .catch(() => {
        if (!aborted) setData(null);
      });
    return () => {
      aborted = true;
    };
  }, [url]);

  const safeHost = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  if (data === "pending") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="my-2 inline-block rounded border border-border bg-bg-muted/40 px-3 py-2 font-sans text-[12px] text-fg-muted"
      >
        loading {safeHost}…
      </a>
    );
  }
  if (!data) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline underline-offset-2"
      >
        {url}
      </a>
    );
  }
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noreferrer"
      className="group my-3 flex gap-3 overflow-hidden rounded-lg border border-border bg-bg-paper transition-all hover:border-border-strong hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_8px_-2px_rgba(0,0,0,0.06)]"
    >
      {data.image && (
        <div className="relative h-auto w-28 flex-shrink-0 overflow-hidden bg-bg-muted">
          <img
            src={data.image}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1 p-3">
        <div>
          <div className="font-display text-[15px] font-medium leading-snug text-fg group-hover:text-accent">
            {data.title}
          </div>
          {data.description && (
            <div className="mt-1 line-clamp-2 font-serif text-[13px] leading-snug text-fg-muted">
              {data.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 font-sans text-[11px] uppercase tracking-wider text-fg-subtle">
          <img src={data.favicon} alt="" className="h-3 w-3" />
          <span>{data.domain}</span>
        </div>
      </div>
    </a>
  );
}

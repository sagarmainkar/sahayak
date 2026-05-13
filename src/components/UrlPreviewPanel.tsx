"use client";

import { useEffect, useRef, useState } from "react";
import { X, ArrowUpRight } from "lucide-react";

type Props = {
  url: string | null;
  onClose: () => void;
};

export function UrlPreviewPanel({ url, onClose }: Props) {
  const [title, setTitle] = useState("");
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((j: { data: { title: string } | null }) => {
        if (cancelled) return;
        if (j.data?.title) {
          setTitle(j.data.title);
        } else {
          try {
            setTitle(new URL(url).hostname);
          } catch {
            setTitle(url);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        try {
          setTitle(new URL(url).hostname);
        } catch {
          setTitle(url);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Close on Escape
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url]);

  if (!url) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-bg-elev shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1 truncate font-sans text-[13px] font-medium text-fg">
            {title || "Preview"}
          </div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
            title="Open in new tab"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
            aria-label="Close preview"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Iframe */}
        <div className="relative flex-1 overflow-hidden">
          <iframe
            src={url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="h-full w-full border-0 bg-bg"
            title={title || url}
          />
        </div>
      </div>
    </div>
  );
}

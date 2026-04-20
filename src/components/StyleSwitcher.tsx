"use client";

import { useEffect, useRef, useState } from "react";
import { Palette, Check } from "lucide-react";
import { useStyleTheme } from "./ThemeProvider";
import { THEMES } from "@/lib/themes";
import { cn } from "@/lib/cn";

export function StyleSwitcher() {
  const { styleId, setStyleId } = useStyleTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Change style"
        className="tt inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
        data-tip="Style"
      >
        <Palette className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-md border border-border bg-bg-elev shadow-[var(--shadow)]">
          <div className="byline border-b border-border px-3 py-2">style</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setStyleId(t.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-bg-muted",
              )}
            >
              <div className="min-w-0">
                <div className="font-display text-[14px] italic text-fg">
                  {t.name}
                </div>
                <div className="font-mono text-[10.5px] text-fg-subtle">
                  {t.tagline}
                </div>
              </div>
              {styleId === t.id && (
                <Check className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

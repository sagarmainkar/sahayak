"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Palette, Check } from "lucide-react";
import { useStyleTheme } from "./ThemeProvider";
import { THEMES } from "@/lib/themes";
import { cn } from "@/lib/cn";

export function StyleSwitcher() {
  const { styleId, setStyleId } = useStyleTheme();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the menu via a portal anchored to the button's bounding
  // rect. The header lives inside an overflow-hidden flex chain that
  // would otherwise clip an absolute-positioned popover. A portal
  // escapes that, and reading the rect lets the menu right-align
  // under the button without relying on CSS positioning that the
  // container can't resolve.
  useEffect(() => {
    if (!open) return;
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCoords({
        top: r.bottom + 6,
        right: Math.max(12, window.innerWidth - r.right),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const menu =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: coords.top,
              right: coords.right,
            }}
            className="z-50 w-[min(16rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border border-border bg-bg-elev shadow-[var(--shadow)]"
          >
            <div className="byline border-b border-border px-3 py-2">
              style
            </div>
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
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Change style"
        className="tt inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
        data-tip="Style"
      >
        <Palette className="h-3.5 w-3.5" />
      </button>
      {menu}
    </>
  );
}

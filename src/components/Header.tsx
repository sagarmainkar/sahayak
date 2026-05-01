"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, Brain, Settings as SettingsIcon, MoreVertical } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { StyleSwitcher } from "./StyleSwitcher";

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-bg-elev px-5 py-2.5">
      <Link href="/" className="flex items-baseline gap-2">
        <span
          className="font-display text-[18px] italic leading-none text-fg"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 40' }}
        >
          Sahayak
        </span>
      </Link>
      <div className="flex flex-1 items-center gap-2">{children}</div>

      {/* Desktop chrome — hidden below sm */}
      <div className="hidden sm:flex items-center gap-2">
        <Link
          href="/memory"
          className="tt inline-flex h-10 w-10 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
          data-tip="Memory"
        >
          <Brain className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/stats"
          className="tt inline-flex h-10 w-10 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
          data-tip="Stats"
        >
          <BarChart3 className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/settings"
          className="tt inline-flex h-10 w-10 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
          data-tip="Settings"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
        </Link>
        <StyleSwitcher />
      </div>

      <ThemeToggle />

      {/* Mobile chrome — only the kebab is visible below sm */}
      <div className="sm:hidden">
        <KebabMenu />
      </div>
    </header>
  );
}

function KebabMenu() {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 6,
        right: Math.max(12, window.innerWidth - rect.right),
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
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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
              width: "min(14rem, calc(100vw - 1.5rem))",
            }}
            className="z-50 overflow-hidden rounded-lg border border-border bg-bg-elev p-1 shadow-[var(--shadow)]"
          >
            <Link
              href="/memory"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded px-3 py-2 font-sans text-[13px] text-fg hover:bg-bg-muted"
            >
              <Brain className="h-3.5 w-3.5 text-fg-muted" />
              Memory
            </Link>
            <Link
              href="/stats"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded px-3 py-2 font-sans text-[13px] text-fg hover:bg-bg-muted"
            >
              <BarChart3 className="h-3.5 w-3.5 text-fg-muted" />
              Stats
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded px-3 py-2 font-sans text-[13px] text-fg hover:bg-bg-muted"
            >
              <SettingsIcon className="h-3.5 w-3.5 text-fg-muted" />
              Settings
            </Link>
            <div className="border-t border-border mt-1 pt-1">
              <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
                Style
              </div>
              <div className="px-2 pb-1">
                <StyleSwitcher />
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-10 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
        aria-label="More actions"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {menu}
    </>
  );
}

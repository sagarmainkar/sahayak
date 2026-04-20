"use client";

import Link from "next/link";
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
      <StyleSwitcher />
      <ThemeToggle />
    </header>
  );
}

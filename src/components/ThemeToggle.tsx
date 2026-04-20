"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun, Monitor } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-7 w-7" />;
  }

  const next =
    theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <button
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Theme: ${theme} · click for ${next}`}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

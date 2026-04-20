"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";
import { createContext, useContext, useEffect, useState } from "react";
import { THEMES, type ThemeId } from "@/lib/themes";

type StyleCtx = {
  styleId: ThemeId;
  setStyleId: (id: ThemeId) => void;
};

const StyleContext = createContext<StyleCtx>({
  styleId: "correspondence",
  setStyleId: () => {},
});

export function useStyleTheme() {
  return useContext(StyleContext);
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <StyleThemeLayer>{children}</StyleThemeLayer>
    </NextThemesProvider>
  );
}

function StyleThemeLayer({ children }: { children: React.ReactNode }) {
  const [styleId, setStyleIdState] = useState<ThemeId>("correspondence");

  // Read persisted style on mount
  useEffect(() => {
    const saved = localStorage.getItem("sahayak:style") as ThemeId | null;
    if (saved && THEMES.find((t) => t.id === saved)) {
      setStyleIdState(saved);
      applyClass(saved);
    } else {
      applyClass("correspondence");
    }
  }, []);

  function applyClass(id: ThemeId) {
    const html = document.documentElement;
    THEMES.forEach((t) => html.classList.remove(t.cls));
    const target = THEMES.find((t) => t.id === id);
    if (target) html.classList.add(target.cls);
  }

  function setStyleId(id: ThemeId) {
    setStyleIdState(id);
    localStorage.setItem("sahayak:style", id);
    applyClass(id);
  }

  return (
    <StyleContext.Provider value={{ styleId, setStyleId }}>
      {children}
    </StyleContext.Provider>
  );
}

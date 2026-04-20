"use client";

import { createContext, useContext, useState } from "react";

type Ctx = {
  openId: string | null;
  open: (id: string) => void;
  close: () => void;
};

const ArtifactPanelContext = createContext<Ctx>({
  openId: null,
  open: () => {},
  close: () => {},
});

export function useArtifactPanel() {
  return useContext(ArtifactPanelContext);
}

export function ArtifactPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ArtifactPanelContext.Provider
      value={{
        openId,
        open: (id) => setOpenId(id),
        close: () => setOpenId(null),
      }}
    >
      {children}
    </ArtifactPanelContext.Provider>
  );
}

"use client";

import { createContext, useContext, useState } from "react";

type Ctx = {
  openId: string | null;
  refreshKey: number;
  open: (id: string) => void;
  close: () => void;
  refresh: () => void;
};

const ArtifactPanelContext = createContext<Ctx>({
  openId: null,
  refreshKey: 0,
  open: () => {},
  close: () => {},
  refresh: () => {},
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
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <ArtifactPanelContext.Provider
      value={{
        openId,
        refreshKey,
        open: (id) => {
          // Re-opening same id still bumps refreshKey so the panel reloads
          // when the model has regenerated the source with the same id.
          setOpenId(id);
          setRefreshKey((k) => k + 1);
        },
        close: () => setOpenId(null),
        refresh: () => setRefreshKey((k) => k + 1),
      }}
    >
      {children}
    </ArtifactPanelContext.Provider>
  );
}

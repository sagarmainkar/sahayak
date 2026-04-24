"use client";

import { createContext, useContext, useState } from "react";

export type ArtifactScope = {
  assistantId: string;
  sessionId: string;
};

type Ctx = {
  openId: string | null;
  scope: ArtifactScope | null;
  refreshKey: number;
  open: (id: string, scope: ArtifactScope) => void;
  close: () => void;
  refresh: () => void;
};

const ArtifactPanelContext = createContext<Ctx>({
  openId: null,
  scope: null,
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
  const [scope, setScope] = useState<ArtifactScope | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <ArtifactPanelContext.Provider
      value={{
        openId,
        scope,
        refreshKey,
        open: (id, s) => {
          // Re-opening same id still bumps refreshKey so the panel reloads
          // when the model has regenerated the source with the same id.
          setOpenId(id);
          setScope(s);
          setRefreshKey((k) => k + 1);
        },
        close: () => {
          setOpenId(null);
          setScope(null);
        },
        refresh: () => setRefreshKey((k) => k + 1),
      }}
    >
      {children}
    </ArtifactPanelContext.Provider>
  );
}

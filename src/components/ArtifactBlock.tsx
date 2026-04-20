"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { ArtifactCard } from "./ArtifactCard";

/** Parse leading `// key: value` comments from the artifact source */
function parseHeader(src: string): { title?: string; id?: string } {
  const out: Record<string, string> = {};
  const lines = src.split("\n").slice(0, 10);
  for (const l of lines) {
    const m = l.match(/^\s*\/\/\s*(title|id)\s*:\s*(.+?)\s*$/i);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

// Per-client-session registry: map source hash → created artifact id
// Prevents re-POSTing when React re-renders.
const registered = new Map<string, string>();

function hashSource(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

export function ArtifactBlock({
  source,
  sessionId,
  assistantId,
}: {
  source: string;
  sessionId?: string | null;
  assistantId?: string | null;
}) {
  const [state, setState] = useState<
    | { kind: "pending" }
    | { kind: "ready"; id: string; title: string }
    | { kind: "error"; message: string }
  >({ kind: "pending" });

  useEffect(() => {
    let cancelled = false;
    const h = hashSource(source);
    const cached = registered.get(h);
    const hdr = parseHeader(source);
    const title = hdr.title ?? "Artifact";

    if (cached) {
      setState({ kind: "ready", id: cached, title });
      return;
    }

    (async () => {
      try {
        const r = await fetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: hdr.id,
            title,
            source,
            sessionId: sessionId ?? null,
            assistantId: assistantId ?? null,
          }),
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = (await r.json()) as { artifact: { id: string; title: string } };
        if (cancelled) return;
        registered.set(h, j.artifact.id);
        setState({
          kind: "ready",
          id: j.artifact.id,
          title: j.artifact.title,
        });
      } catch (e) {
        if (!cancelled) {
          setState({ kind: "error", message: (e as Error).message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (state.kind === "pending") {
    return (
      <div className="my-3 flex items-center gap-3 rounded-lg border border-border bg-bg-paper px-3 py-2.5 not-prose">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
        <div>
          <div className="byline">artifact</div>
          <div className="font-display text-[13px] italic text-fg-muted">
            preparing…
          </div>
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="my-3 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-500 not-prose">
        <AlertTriangle className="h-3.5 w-3.5" />
        artifact error: {state.message}
      </div>
    );
  }
  return <ArtifactCard id={state.id} title={state.title} />;
}

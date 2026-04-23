"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Wand2 } from "lucide-react";
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
// Per-source auto-retry counter. Keyed by source hash so a turn that
// keeps emitting the same broken source doesn't retry forever.
const autoRetries = new Map<string, number>();
const MAX_AUTO_RETRIES = 2;

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
  onAutoFix,
}: {
  source: string;
  sessionId?: string | null;
  assistantId?: string | null;
  /** Called when the server rejects the artifact's JSX as invalid.
   *  The parent can optionally kick off a silent follow-up turn
   *  asking the model to re-emit. Callee receives the compile error
   *  message. */
  onAutoFix?: (error: string) => void;
}) {
  const [state, setState] = useState<
    | { kind: "pending" }
    | { kind: "ready"; id: string; title: string }
    | { kind: "validation"; error: string; retrying: boolean }
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
        if (r.status === 422) {
          const j = (await r.json()) as {
            error: string;
            message?: string;
          };
          const msg = j.message ?? "syntax error";
          if (cancelled) return;
          const attempts = (autoRetries.get(h) ?? 0) + 1;
          autoRetries.set(h, attempts);
          const canRetry = !!onAutoFix && attempts <= MAX_AUTO_RETRIES;
          setState({
            kind: "validation",
            error: msg,
            retrying: canRetry,
          });
          if (canRetry) {
            // Fire the silent fix turn. Parent chooses how to phrase
            // and whether to persist it.
            onAutoFix(msg);
          }
          return;
        }
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = (await r.json()) as {
          artifact: { id: string; title: string };
        };
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
  }, [source, sessionId, assistantId, onAutoFix]);

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
  if (state.kind === "validation") {
    return (
      <div className="my-3 flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 not-prose">
        {state.retrying ? (
          <Wand2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-pulse text-amber-600 dark:text-amber-400" />
        ) : (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="byline mb-0.5">
            {state.retrying
              ? "artifact · auto-fixing"
              : "artifact · compile error"}
          </div>
          <div className="font-mono text-[11px] leading-snug text-fg-muted">
            {state.error}
          </div>
          {state.retrying && (
            <div className="mt-1 font-serif text-[11px] italic text-fg-subtle">
              asking the model to correct and re-emit…
            </div>
          )}
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

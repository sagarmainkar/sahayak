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
  /** Required — the server won't create an artifact without an owning
   *  session. May be null/undefined while the Chat is still resolving
   *  the session id; we render a pending state until it's available. */
  sessionId?: string | null;
  assistantId?: string | null;
  /** Called when the model needs to re-emit a broken artifact — both
   *  for the silent auto-retry path AND when the user clicks "Try
   *  fix". Callee receives the compile-error message. */
  onAutoFix?: (error: string) => void;
}) {
  /**
   * The server now ALWAYS creates the artifact, even on bad JSX —
   * `validationError` rides along when present. That means once we
   * have an id, the user can always open the panel to see the
   * source + the error, regardless of whether auto-fix has given up.
   */
  const [state, setState] = useState<
    | { kind: "pending" }
    | {
        kind: "ready";
        id: string;
        title: string;
        validationError?: string;
        retrying: boolean;
      }
    | { kind: "error"; message: string }
  >({ kind: "pending" });

  useEffect(() => {
    let cancelled = false;
    const h = hashSource(source);
    const cached = registered.get(h);
    const hdr = parseHeader(source);
    const title = hdr.title ?? "Artifact";

    if (cached) {
      setState({ kind: "ready", id: cached, title, retrying: false });
      return;
    }

    // Scope is required by the server — don't POST until we have both
    // ids. The parent (Chat) resolves sessionId as soon as the first
    // user turn fires, so this is only a brief pending state.
    if (!sessionId || !assistantId) return;

    (async () => {
      try {
        const r = await fetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: hdr.id,
            title,
            source,
            sessionId,
            assistantId,
          }),
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = (await r.json()) as {
          artifact: { id: string; title: string };
          validationError?: string | null;
        };
        if (cancelled) return;
        registered.set(h, j.artifact.id);
        const validationError = j.validationError ?? undefined;
        // Auto-fix path: if the model emitted broken JSX and we
        // haven't burned the retry budget, kick off a silent fix
        // turn. Otherwise the user can still open the artifact +
        // click "Try fix" manually.
        let retrying = false;
        if (validationError) {
          const attempts = (autoRetries.get(h) ?? 0) + 1;
          autoRetries.set(h, attempts);
          retrying = !!onAutoFix && attempts <= MAX_AUTO_RETRIES;
          if (retrying) onAutoFix!(validationError);
        }
        setState({
          kind: "ready",
          id: j.artifact.id,
          title: j.artifact.title,
          validationError,
          retrying,
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
  if (state.kind === "error") {
    // Network/server error — different from a JSX validation error,
    // and we have no id to open. Show a flat banner.
    return (
      <div className="my-3 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-500 not-prose">
        <AlertTriangle className="h-3.5 w-3.5" />
        artifact error: {state.message}
      </div>
    );
  }
  // kind === "ready" — always renders the card so the user can open
  // the panel. If validationError is set, the card is decorated and
  // a Try-fix button sits beside it.
  return (
    <div className="my-3 not-prose">
      <ArtifactCard
        id={state.id}
        title={state.title}
        assistantId={assistantId!}
        sessionId={sessionId!}
      />
      {state.validationError && (
        <div className="mt-2 flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          {state.retrying ? (
            <Wand2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-pulse text-amber-600 dark:text-amber-400" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <div className="min-w-0 flex-1">
            <div className="byline mb-0.5">
              {state.retrying
                ? "compile error · auto-fixing"
                : "compile error"}
            </div>
            <div className="font-mono text-[11px] leading-snug text-fg-muted">
              {state.validationError}
            </div>
            {state.retrying ? (
              <div className="mt-1 font-serif text-[11px] italic text-fg-subtle">
                asking the model to correct and re-emit…
              </div>
            ) : (
              onAutoFix && (
                <button
                  type="button"
                  onClick={() => onAutoFix(state.validationError!)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-sans text-[11px] text-amber-700 hover:border-amber-500 hover:bg-amber-500/20 dark:text-amber-300"
                >
                  <Wand2 className="h-3 w-3" />
                  Try fix
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

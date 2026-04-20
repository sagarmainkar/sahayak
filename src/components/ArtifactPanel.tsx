"use client";

import { useEffect, useRef, useState } from "react";
import {
  X, RefreshCw, Code2, Download, Copy, Maximize2, Minimize2, Check,
} from "lucide-react";
import { useArtifactPanel } from "./ArtifactPanelContext";
import type { Artifact } from "@/lib/types";
import { cn } from "@/lib/cn";

export function ArtifactPanel() {
  const { openId, close } = useArtifactPanel();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load artifact
  useEffect(() => {
    if (!openId) {
      setArtifact(null);
      setIframeReady(false);
      setShowSource(false);
      return;
    }
    fetch(`/api/artifacts/${openId}`)
      .then((r) => r.json())
      .then((d: { artifact: Artifact }) => setArtifact(d.artifact));
  }, [openId]);

  // Bridge: iframe → parent → /api/artifact-data
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data as {
        sahayak?: boolean;
        type?: string;
        reqId?: number;
        filename?: string;
        as?: "auto" | "text" | "json" | "csv";
      };
      if (!d || !d.sahayak || !iframeRef.current?.contentWindow) return;
      if (e.source !== iframeRef.current.contentWindow) return;

      if (d.type === "ready") {
        setIframeReady(true);
        return;
      }
      if (d.type === "fetch_data" && openId && d.filename) {
        fetch(`/api/artifact-data/${openId}/${d.filename}`)
          .then(async (r) => {
            if (!r.ok) throw new Error(`status ${r.status}`);
            const ct = r.headers.get("content-type") ?? "";
            const as = d.as ?? "auto";
            if (as === "json" || ct.includes("json")) {
              return { payload: await r.json() };
            }
            if (as === "csv" || ct.includes("csv") || ct.includes("text")) {
              return { payload: await r.text() };
            }
            // fallback: text
            return { payload: await r.text() };
          })
          .then((res) => {
            iframeRef.current?.contentWindow?.postMessage(
              {
                sahayak: true,
                type: "fetch_data_response",
                reqId: d.reqId,
                payload: res.payload,
              },
              "*",
            );
          })
          .catch((err) => {
            iframeRef.current?.contentWindow?.postMessage(
              {
                sahayak: true,
                type: "fetch_data_response",
                reqId: d.reqId,
                error: String(err),
              },
              "*",
            );
          });
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [openId]);

  // When both iframe + artifact are ready, send source
  useEffect(() => {
    if (!iframeReady || !artifact || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { sahayak: true, type: "render", source: artifact.source },
      "*",
    );
  }, [iframeReady, artifact]);

  function reload() {
    setIframeReady(false);
    const f = iframeRef.current;
    if (!f) return;
    f.src = f.src;
  }

  async function copySource() {
    if (!artifact) return;
    await navigator.clipboard.writeText(artifact.source);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function downloadSource() {
    if (!artifact) return;
    const blob = new Blob([artifact.source], { type: "text/jsx" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.id}.jsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!openId) return null;

  return (
    <aside
      className={cn(
        "flex flex-col border-l border-border bg-bg-elev",
        fullscreen
          ? "fixed inset-0 z-40 border-0"
          : "w-[min(640px,50vw)]",
      )}
    >
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          ✨
        </div>
        <div className="min-w-0 flex-1">
          <div className="byline">artifact</div>
          <div className="truncate font-display text-[13px] italic">
            {artifact?.title ?? "loading…"}
          </div>
        </div>
        <button
          onClick={reload}
          className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
          data-tip="Reload"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setShowSource((v) => !v)}
          className={cn(
            "tt rounded p-1 hover:bg-bg-muted",
            showSource ? "text-accent" : "text-fg-muted hover:text-fg",
          )}
          data-tip="Toggle source"
        >
          <Code2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={copySource}
          className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
          data-tip="Copy source"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={downloadSource}
          className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
          data-tip="Download .jsx"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setFullscreen((v) => !v)}
          className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
          data-tip={fullscreen ? "Restore" : "Fullscreen"}
        >
          {fullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={close}
          className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
          data-tip="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* body */}
      <div className="flex-1 overflow-hidden">
        {showSource ? (
          <pre className="m-0 h-full overflow-auto p-3 font-mono text-[12px] leading-[1.55] text-fg">
            {artifact?.source ?? ""}
          </pre>
        ) : (
          <iframe
            ref={iframeRef}
            src="/artifact-runtime.html"
            sandbox="allow-scripts"
            className="h-full w-full border-0 bg-bg"
            title={artifact?.title ?? "artifact"}
          />
        )}
      </div>
    </aside>
  );
}

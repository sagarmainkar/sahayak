"use client";

import { useEffect, useRef, useState } from "react";
import {
  X, RefreshCw, Code2, Download, Copy, Maximize2, Minimize2, Check,
  Wand2, Pin, Camera, Loader2,
} from "lucide-react";
import { toPng } from "html-to-image";
import { useArtifactPanel } from "./ArtifactPanelContext";
import type { Artifact, MsgAttachment } from "@/lib/types";
import { cn } from "@/lib/cn";

type Props = {
  /** Called when the user clicks "Ask to fix" on a runtime error. */
  onFixRequest?: (prompt: string) => void;
  /** Called when the user snaps a screenshot of the artifact. The
   *  attachment is already uploaded server-side; the parent just needs
   *  to stage it on the composer. */
  onAttachScreenshot?: (a: MsgAttachment) => void;
};

export function ArtifactPanel({
  onFixRequest,
  onAttachScreenshot,
}: Props = {}) {
  const { openId, refreshKey: externalRefreshKey, close } = useArtifactPanel();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const refreshKey = externalRefreshKey + localRefreshKey;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  /** Capture the iframe's rendered document to a PNG and hand the
   *  resulting attachment back to the composer. Uses html-to-image on
   *  the iframe's contentDocument.body since the iframe is same-origin
   *  (/artifact-runtime.html). */
  async function snapScreenshot() {
    if (!onAttachScreenshot || capturing) return;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const target = doc?.body;
    if (!iframe || !doc || !target) {
      console.error("[artifact screenshot] Cannot access iframe contentDocument — sandbox may block same-origin access");
      return;
    }
    setCapturing(true);
    try {
      const width = target.scrollWidth || iframe.clientWidth;
      const height = target.scrollHeight || iframe.clientHeight;
      const dataUrl = await toPng(target, {
        width,
        height,
        pixelRatio: Math.min(window.devicePixelRatio ?? 1, 2),
        cacheBust: true,
        backgroundColor: getComputedStyle(target).backgroundColor || "#ffffff",
      });
      const blob = await (await fetch(dataUrl)).blob();
      const baseName = (artifact?.title ?? "artifact")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .slice(0, 40) || "artifact";
      const file = new File(
        [blob],
        `${baseName}-${Date.now()}.png`,
        { type: "image/png" },
      );
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/uploads", { method: "POST", body: fd });
      if (!r.ok) throw new Error(`upload ${r.status}`);
      const j = (await r.json()) as {
        attachment: {
          mimeType: string;
          url: string;
          kind: "image" | "document";
        };
      };
      const filename = j.attachment.url.split("/").pop() ?? "";
      if (j.attachment.kind !== "image") throw new Error("non-image upload");
      onAttachScreenshot({
        type: "image",
        mimeType: j.attachment.mimeType,
        filename,
        originalName: file.name,
      });
    } catch (e) {
      console.error("[artifact screenshot]", e);
    } finally {
      setCapturing(false);
    }
  }

  const isHtmlDoc =
    !!artifact && /^\s*(<!doctype\s+html|<html[\s>])/i.test(artifact.source);

  // Load artifact — refetches whenever openId or refreshKey changes
  useEffect(() => {
    if (!openId) {
      setArtifact(null);
      setIframeReady(false);
      setShowSource(false);
      setRuntimeError(null);
      return;
    }
    // Reset error state when the panel's artifact changes or refreshes.
    setRuntimeError(null);
    fetch(`/api/artifacts/${openId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { artifact: Artifact }) => setArtifact(d.artifact));
  }, [openId, refreshKey]);

  // Bridge: iframe → parent → /api/artifact-data
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data as {
        sahayak?: boolean;
        type?: string;
        reqId?: number;
        filename?: string;
        as?: "auto" | "text" | "json" | "csv";
        message?: string;
      };
      if (!d || !d.sahayak || !iframeRef.current?.contentWindow) return;
      if (e.source !== iframeRef.current.contentWindow) return;

      if (d.type === "ready") {
        setIframeReady(true);
        return;
      }
      if (d.type === "error") {
        // Runtime error from the iframe (render, script, or unhandled promise).
        setRuntimeError(String(d.message ?? "unknown runtime error"));
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

  // When both iframe + artifact are ready, send source (JSX path only —
  // HTML docs render via `srcdoc` and don't need the postMessage handshake).
  useEffect(() => {
    if (isHtmlDoc) return;
    if (!iframeReady || !artifact || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { sahayak: true, type: "render", source: artifact.source },
      "*",
    );
  }, [iframeReady, artifact, isHtmlDoc]);

  async function togglePin() {
    if (!artifact) return;
    const nextPinned = !artifact.pinned;
    setArtifact({ ...artifact, pinned: nextPinned });
    try {
      await fetch(`/api/artifacts/${artifact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
    } catch {
      setArtifact({ ...artifact, pinned: !nextPinned });
    }
  }

  function reload() {
    setIframeReady(false);
    setLocalRefreshKey((k) => k + 1); // refetches source + remounts iframe via key
  }

  async function copySource() {
    if (!artifact) return;
    await navigator.clipboard.writeText(artifact.source);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function askToFix() {
    if (!artifact || !runtimeError || !onFixRequest) return;
    const title = artifact.title || "the artifact";
    const id = artifact.id;
    // Template the model has a clear hook to regenerate in-place: same id.
    const prompt =
      `The "${title}" artifact errored at runtime:\n\n` +
      "```\n" +
      runtimeError.trim() +
      "\n```\n\n" +
      `Please diagnose the root cause in one short paragraph, then emit ` +
      `the corrected \`\`\`react-artifact fence using the same ` +
      `\`// id: ${id}\`. Keep the fix minimal — don't rewrite working ` +
      `parts. If the error is from a bad import or missing global, ` +
      `remember the runtime only exposes React, Recharts, Papa, and the ` +
      `Sahayak.fetchData data bridge.`;
    onFixRequest(prompt);
    setRuntimeError(null); // dismiss locally; the resend flow will open a new turn
  }

  function downloadSource() {
    if (!artifact) return;
    const ext = isHtmlDoc ? "html" : "jsx";
    const mime = isHtmlDoc ? "text/html" : "text/jsx";
    const blob = new Blob([artifact.source], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.id}.${ext}`;
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
          : // Mobile: full-screen overlay. Desktop (≥md): side column
            // 50vw-wide, capped at 640px. Fullscreen branch above takes
            // precedence on either size.
            "fixed inset-0 z-40 md:static md:z-auto md:w-[min(640px,50vw)]",
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
        {runtimeError && onFixRequest && (
          <button
            onClick={askToFix}
            className="tt flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-sans text-[11px] text-red-500 hover:bg-red-500/15"
            data-tip="Send error to assistant for a fix"
          >
            <Wand2 className="h-3 w-3" />
            Ask to fix
          </button>
        )}
        <button
          onClick={togglePin}
          className={cn(
            "tt rounded p-1 hover:bg-bg-muted",
            artifact?.pinned ? "text-accent" : "text-fg-muted hover:text-fg",
          )}
          data-tip={
            artifact?.pinned
              ? "Pinned — protected from auto-cleanup"
              : "Pin (protect from auto-cleanup)"
          }
        >
          <Pin
            className={cn(
              "h-3.5 w-3.5",
              artifact?.pinned && "fill-accent",
            )}
          />
        </button>
        {onAttachScreenshot && iframeReady && !runtimeError && (
          <button
            onClick={snapScreenshot}
            disabled={capturing}
            className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg disabled:opacity-50"
            data-tip={
              capturing
                ? "Capturing…"
                : "Snap current view → attach to composer"
            }
          >
            {capturing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
          </button>
        )}
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
          data-tip={isHtmlDoc ? "Download .html" : "Download .jsx"}
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
        ) : isHtmlDoc ? (
          <iframe
            key={`html-${openId}-${refreshKey}`}
            ref={iframeRef}
            srcDoc={artifact?.source ?? ""}
            sandbox="allow-scripts allow-same-origin"
            className="h-full w-full border-0 bg-bg"
            title={artifact?.title ?? "artifact"}
          />
        ) : (
          <iframe
            key={`jsx-${openId}-${refreshKey}`}
            ref={iframeRef}
            src="/artifact-runtime.html"
            sandbox="allow-scripts allow-same-origin"
            className="h-full w-full border-0 bg-bg"
            title={artifact?.title ?? "artifact"}
          />
        )}
      </div>
    </aside>
  );
}

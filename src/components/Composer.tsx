"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Paperclip,
  Send,
  X,
  Loader2,
  Sparkles,
  Mic,
  Volume2,
  VolumeX,
  FileText,
  FilePlus,
  Lock,
  Unlock,
  LayoutTemplate,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { MEMORY_TYPES, type MemoryType, type MsgAttachment } from "@/lib/types";
import { TEMPLATE_META } from "@/lib/templates";

type SlashOutcome =
  | { kind: "saved"; type: MemoryType; content: string }
  | { kind: "forgot"; id: string }
  | { kind: "error"; message: string };

// /remember foo         → type: fact
// /pref|preference foo  → type: preference
// /event foo            → type: event
// /episodic|episode foo → type: episodic
// /procedural|how foo   → type: procedural
// /semantic foo         → type: semantic
// /forget <id-prefix>
const SLASH_MAP: Record<string, MemoryType | "forget"> = {
  remember: "fact",
  fact: "fact",
  pref: "preference",
  preference: "preference",
  event: "event",
  episodic: "episodic",
  episode: "episodic",
  procedural: "procedural",
  how: "procedural",
  semantic: "semantic",
  forget: "forget",
};

async function handleSlash(raw: string): Promise<SlashOutcome | null> {
  const m = raw.match(/^\/([a-z]+)(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  const rest = (m[2] ?? "").trim();
  const action = SLASH_MAP[verb];
  if (!action) return null;

  if (action === "forget") {
    if (!rest) return { kind: "error", message: "usage: /forget <id-prefix>" };
    // Match by id-prefix via GET list, find first match, delete.
    try {
      const r = await fetch("/api/memory");
      const d = (await r.json()) as { memories: { id: string }[] };
      const hit = d.memories.find((x) => x.id.startsWith(rest));
      if (!hit) return { kind: "error", message: `no memory matches "${rest}"` };
      const del = await fetch(`/api/memory/${hit.id}`, { method: "DELETE" });
      if (!del.ok) return { kind: "error", message: `delete failed` };
      return { kind: "forgot", id: hit.id };
    } catch (e) {
      return { kind: "error", message: (e as Error).message };
    }
  }

  if (!rest) {
    return {
      kind: "error",
      message: `usage: /${verb} <text>`,
    };
  }
  if (!(MEMORY_TYPES as readonly string[]).includes(action)) {
    return { kind: "error", message: `unknown type ${action}` };
  }
  try {
    const r = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: action, content: rest, source: "user" }),
    });
    if (!r.ok) {
      return { kind: "error", message: `save failed (${r.status})` };
    }
    return { kind: "saved", type: action as MemoryType, content: rest };
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
}

type Props = {
  assistantName: string;
  streaming: boolean;
  onSend: (
    text: string,
    attachments: MsgAttachment[],
    artifactsEnabled: boolean,
    templateId: string | null,
  ) => void;
  onAbort: () => void;
  autoSpeak: boolean;
  onAutoSpeakToggle: () => void;
  /** Externally-staged attachment (e.g. from the artifact screenshot
   *  button). When non-null, Composer appends it to its attachment list
   *  and calls `onPendingAttachmentConsumed` so the parent can clear
   *  the slot. Composer never holds a reference to the parent's state. */
  pendingAttachment?: MsgAttachment | null;
  onPendingAttachmentConsumed?: () => void;
};

type UploadResponse = {
  attachment: {
    mimeType: string;
    url: string;
    kind: "image" | "document";
    textFilename?: string;
    bytes: number;
  };
};

type UploadResult =
  | { ok: true; attachment: MsgAttachment }
  | { ok: false; reason: string }
  | { ok: false; needsPassword: true; message: string; retry: boolean };

async function uploadOne(
  file: File,
  password?: string,
): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  if (password) fd.append("password", password);
  try {
    const r = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!r.ok) {
      try {
        const j = await r.json();
        if (j?.error === "pdf_encrypted" || j?.error === "pdf_bad_password") {
          return {
            ok: false,
            needsPassword: true,
            message: String(j.message ?? ""),
            retry: j.error === "pdf_bad_password",
          };
        }
        if (j?.error) return { ok: false, reason: String(j.error) };
      } catch {}
      return { ok: false, reason: `HTTP ${r.status}` };
    }
    const j = (await r.json()) as UploadResponse;
    const filename = j.attachment.url.split("/").pop() ?? "";
    if (j.attachment.kind === "document" && j.attachment.textFilename) {
      return {
        ok: true,
        attachment: {
          type: "document",
          mimeType: j.attachment.mimeType,
          filename,
          textFilename: j.attachment.textFilename,
          bytes: j.attachment.bytes,
          originalName: file.name,
        },
      };
    }
    return {
      ok: true,
      attachment: {
        type: "image",
        mimeType: j.attachment.mimeType,
        filename,
        originalName: file.name,
      },
    };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

const DOC_EXTENSIONS =
  ".pdf,.md,.txt,.csv,.docx,.xlsx,.pptx," +
  "application/pdf," +
  "text/markdown,text/plain,text/csv," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function classifyFile(f: File): "image" | "document" | "other" {
  if (f.type.startsWith("image/")) return "image";
  const nameExt = f.name.split(".").pop()?.toLowerCase() ?? "";
  const docExts = ["pdf", "md", "txt", "csv", "docx", "xlsx", "pptx"];
  if (docExts.includes(nameExt)) return "document";
  if (/(pdf|word|spreadsheet|presentation|text|csv|markdown)/.test(f.type))
    return "document";
  return "other";
}

export function Composer({
  assistantName,
  streaming,
  onSend,
  onAbort,
  autoSpeak,
  onAutoSpeakToggle,
  pendingAttachment,
  onPendingAttachmentConsumed,
}: Props) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<MsgAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  // Session-sticky: stays on across turns until toggled off.
  const [artifactsEnabled, setArtifactsEnabled] = useState(false);
  // Per-turn: cleared after send. Null = no template active.
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const templateBtnRef = useRef<HTMLButtonElement | null>(null);
  const templateMenuRef = useRef<HTMLDivElement | null>(null);
  // Fixed-position coords for the portal'd menu. Anchored above the
  // button — the composer lives at the bottom of the viewport so the
  // menu opens upward. Capturing via getBoundingClientRect sidesteps
  // the overflow-clip on the toolbar's scroll track (CSS auto
  // overflow on one axis implicitly computes auto on the other).
  const [templateCoords, setTemplateCoords] = useState<{
    bottom: number;
    left: number;
  } | null>(null);
  useEffect(() => {
    if (!showTemplatePicker) return;
    function place() {
      const el = templateBtnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // 20rem menu but clamped to viewport below via max-width; the
      // left edge is clamped so the menu never escapes the screen on
      // either side.
      const menuWidth = Math.min(320, window.innerWidth - 24);
      const left = Math.max(
        12,
        Math.min(r.left, window.innerWidth - menuWidth - 12),
      );
      setTemplateCoords({
        bottom: window.innerHeight - r.top + 6,
        left,
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [showTemplatePicker]);
  // Click-outside closer. Needs to ignore clicks on either the button
  // OR the portal'd menu, since they're no longer ancestor/descendant
  // of each other.
  useEffect(() => {
    if (!showTemplatePicker) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (templateBtnRef.current?.contains(t)) return;
      if (templateMenuRef.current?.contains(t)) return;
      setShowTemplatePicker(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showTemplatePicker]);
  const [slashNote, setSlashNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Consume externally-staged attachments (e.g. artifact screenshots).
  // This is a one-shot signal from parent → child; setState-in-effect
  // is deliberate here because the value ORIGINATES outside our state
  // and must be absorbed into it once per change. Dedup by filename so
  // strict-mode double-invokes don't attach twice.
  useEffect(() => {
    if (!pendingAttachment) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAttachments((prev) => {
      const key = pendingAttachment.filename ?? "";
      if (key && prev.some((a) => a.filename === key)) return prev;
      return [...prev, pendingAttachment];
    });
    onPendingAttachmentConsumed?.();
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [pendingAttachment, onPendingAttachmentConsumed]);
  // Encrypted PDFs queue up here; we show a password prompt for the
  // head-of-queue entry until the user unlocks or skips.
  const [pendingEncrypted, setPendingEncrypted] = useState<
    { file: File; message: string }[]
  >([]);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  function flashNote(msg: string, ms = 2500) {
    setSlashNote(msg);
    setTimeout(() => setSlashNote((cur) => (cur === msg ? null : cur)), ms);
  }

  async function startRecording() {
    if (recording || transcribing) return;
    // navigator.mediaDevices is only exposed in a secure context —
    // HTTPS or localhost. Opening the dev server over plain HTTP (e.g.
    // from a phone on the LAN) leaves it undefined. Surface a helpful
    // message instead of a cryptic property-read error.
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      // Two common failure modes on mobile:
      //  - Serving over http:// (mediaDevices is gated to secure
      //    context); reach for HTTPS or localhost.
      //  - Browser genuinely doesn't support getUserMedia.
      // Either way, the OS keyboard's native dictate button is a
      // zero-friction workaround — tell the user to use that.
      const touchDevice =
        typeof window !== "undefined" &&
        "ontouchstart" in window;
      const insecure =
        typeof window !== "undefined" && window.isSecureContext === false;
      const reason = touchDevice
        ? "Tip: tap the mic on your keyboard to dictate. (Our in-app mic needs HTTPS.)"
        : insecure
          ? "Voice input needs HTTPS (or localhost). Open Sahayak over https://…"
          : "Voice input isn't supported in this browser.";
      flashNote(reason, 6000);
      textareaRef.current?.focus();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Pick a mime type the browser supports; fall back to default.
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = candidates.find((c) => MediaRecorder.isTypeSupported(c));
      const rec = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        setRecording(false);
        await transcribe(blob);
      };
      rec.start();
      setRecording(true);
    } catch (e) {
      flashNote(`mic error: ${(e as Error).message}`, 4000);
    }
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  async function transcribe(blob: Blob) {
    setTranscribing(true);
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : "webm";
      const fd = new FormData();
      fd.append("audio", blob, `clip.${ext}`);
      const r = await fetch("/api/transcribe", { method: "POST", body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: "unknown" }));
        flashNote(`transcribe failed: ${j.error ?? r.status}`, 4000);
        return;
      }
      const j = (await r.json()) as { text: string };
      const text = (j.text ?? "").trim();
      if (!text) {
        flashNote("no speech detected", 2500);
        return;
      }
      // Append to whatever the user has already typed.
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    } catch (e) {
      flashNote(`transcribe error: ${(e as Error).message}`, 4000);
    } finally {
      setTranscribing(false);
    }
  }

  function clear() {
    setInput("");
    setAttachments([]);
  }

  async function submit() {
    if (streaming || uploading > 0) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;

    // Slash-command intercept — consumed entirely client-side, no LLM turn.
    if (text.startsWith("/")) {
      const outcome = await handleSlash(text);
      if (outcome) {
        if (outcome.kind === "saved") {
          flashNote(`remembered · ${outcome.type}: ${outcome.content}`);
        } else if (outcome.kind === "forgot") {
          flashNote(`forgot · ${outcome.id}`);
        } else {
          flashNote(outcome.message);
        }
        setInput("");
        return;
      }
    }

    onSend(text, attachments, artifactsEnabled, activeTemplate);
    setActiveTemplate(null);
    clear();
  }

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(
      (f) => classifyFile(f) !== "other",
    );
    const skipped = Array.from(files).length - arr.length;
    if (skipped > 0) {
      flashNote(`${skipped} file(s) skipped — unsupported type`, 3000);
    }
    if (!arr.length) return;
    setUploading((n) => n + arr.length);
    const results = await Promise.all(
      arr.map(async (f) => ({ file: f, res: await uploadOne(f) })),
    );
    const successes: MsgAttachment[] = [];
    const failures: string[] = [];
    const encryptedQueue: { file: File; message: string }[] = [];
    for (const { file, res } of results) {
      if (res.ok) {
        successes.push(res.attachment);
      } else if ("needsPassword" in res) {
        encryptedQueue.push({ file, message: res.message });
      } else {
        failures.push(`${file.name}: ${res.reason}`);
      }
    }
    if (failures.length) {
      flashNote(`upload failed — ${failures[0]}`, 6000);
      console.error("[upload] failures:", failures);
    }
    setAttachments((prev) => [...prev, ...successes]);
    if (encryptedQueue.length) {
      setPendingEncrypted((prev) => [...prev, ...encryptedQueue]);
    }
    setUploading((n) => n - arr.length);
  }

  async function unlockEncrypted(password: string) {
    const first = pendingEncrypted[0];
    if (!first || !password) return;
    setUnlocking(true);
    try {
      const res = await uploadOne(first.file, password);
      if (res.ok) {
        setAttachments((prev) => [...prev, res.attachment]);
        setPendingEncrypted((prev) => prev.slice(1));
        setUnlockPassword("");
      } else if ("needsPassword" in res) {
        // Wrong password — keep the prompt, update the message.
        setPendingEncrypted((prev) =>
          prev.length
            ? [{ file: prev[0].file, message: res.message }, ...prev.slice(1)]
            : prev,
        );
      } else {
        flashNote(`unlock failed — ${res.reason}`, 4000);
        setPendingEncrypted((prev) => prev.slice(1));
        setUnlockPassword("");
      }
    } finally {
      setUnlocking(false);
    }
  }

  function skipEncrypted() {
    setPendingEncrypted((prev) => prev.slice(1));
    setUnlockPassword("");
  }

  function imgSrcFor(a: MsgAttachment): string {
    if (a.type !== "image") return "";
    if (a.filename) return `/api/attachment/${a.filename}`;
    if (a.data) return `data:${a.mimeType};base64,${a.data}`;
    return "";
  }

  return (
    <div className="border-t border-border bg-bg-elev px-4 py-3">
      <div className="mx-auto max-w-[74ch]">
        {pendingEncrypted.length > 0 && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <Lock className="h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11.5px] text-fg">
                {pendingEncrypted[0].file.name}
              </div>
              <div className="font-sans text-[10.5px] text-fg-muted">
                {pendingEncrypted[0].message}
                {pendingEncrypted.length > 1 &&
                  ` · ${pendingEncrypted.length - 1} more queued`}
              </div>
            </div>
            <input
              type="password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && unlockPassword) {
                  e.preventDefault();
                  unlockEncrypted(unlockPassword);
                }
              }}
              placeholder="password"
              autoFocus
              disabled={unlocking}
              className="w-40 rounded border border-border bg-bg px-2 py-1 font-mono text-[12px] focus:border-accent focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={() => unlockEncrypted(unlockPassword)}
              disabled={!unlockPassword || unlocking}
              className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 font-sans text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              {unlocking ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Unlock className="h-3 w-3" />
              )}
              Unlock
            </button>
            <button
              onClick={skipEncrypted}
              disabled={unlocking}
              className="rounded border border-border px-2 py-1 font-sans text-[11px] text-fg-muted hover:text-fg disabled:opacity-40"
            >
              Skip
            </button>
          </div>
        )}
        {(attachments.length > 0 || uploading > 0) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => {
              const remove = () =>
                setAttachments((p) => p.filter((_, k) => k !== i));
              if (a.type === "image") {
                return (
                  <div key={i} className="relative">
                    <img
                      src={imgSrcFor(a)}
                      alt=""
                      className="h-16 w-16 rounded border border-border object-cover"
                    />
                    <button
                      onClick={remove}
                      className="absolute -right-1 -top-1 rounded-full bg-bg p-0.5 text-fg-muted hover:text-fg"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              }
              // document chip
              const ext = (a.filename ?? "").split(".").pop() ?? "doc";
              const kb = a.bytes ? Math.round(a.bytes / 1024) : null;
              return (
                <div
                  key={i}
                  className="relative flex h-16 items-center gap-2 rounded border border-border bg-bg-paper px-3 pr-8"
                  title={a.originalName ?? a.filename}
                >
                  <FileText className="h-5 w-5 flex-shrink-0 text-fg-subtle" />
                  <div className="min-w-0">
                    <div className="max-w-[22ch] truncate font-mono text-[12px] text-fg">
                      {a.originalName ?? a.filename}
                    </div>
                    <div className="font-sans text-[10.5px] text-fg-subtle">
                      .{ext}
                      {kb !== null ? ` · ${kb} KB` : ""}
                    </div>
                  </div>
                  <button
                    onClick={remove}
                    className="absolute -right-1 -top-1 rounded-full bg-bg p-0.5 text-fg-muted hover:text-fg"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            {uploading > 0 && (
              <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-border">
                <Loader2 className="h-4 w-4 animate-spin text-fg-subtle" />
              </div>
            )}
          </div>
        )}
        {activeTemplate &&
          (() => {
            const t = TEMPLATE_META.find((x) => x.id === activeTemplate);
            if (!t) return null;
            return (
              <div className="mb-1.5 inline-flex items-center gap-1.5 self-start rounded-full border border-accent/50 bg-accent-soft/40 px-2.5 py-1 font-sans text-[11px] text-fg">
                <span>{t.icon}</span>
                <span>
                  response will use the{" "}
                  <span className="font-medium">{t.name}</span> template
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTemplate(null)}
                  className="ml-0.5 rounded-full p-0.5 text-fg-subtle hover:bg-bg-muted hover:text-fg"
                  aria-label="Remove template"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })()}
        <div className="rounded-lg border border-border bg-bg focus-within:border-accent">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape" && streaming) onAbort();
            }}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.items)
                .filter((i) => i.type.startsWith("image/"))
                .map((i) => i.getAsFile())
                .filter((f): f is File => !!f);
              if (imgs.length) {
                e.preventDefault();
                addFiles(imgs);
              }
            }}
            placeholder={`Write to ${assistantName}…`}
            rows={2}
            className="block w-full resize-none border-0 bg-transparent px-3 py-2.5 font-serif text-[15px] leading-relaxed text-fg placeholder:italic placeholder:text-fg-subtle focus:outline-none"
          />
          {/* Toolbar row lives BELOW the textarea: buttons on the left
              (horizontal-scrollable if they overflow a narrow viewport),
              send on the right. Gives the typing area full width. */}
          <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1.5">
          <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <label
            className="tt tt-above flex flex-shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 font-sans text-[11px] text-fg-subtle hover:bg-bg-muted hover:text-fg"
            data-tip="Attach image"
          >
            <Paperclip className="h-3.5 w-3.5" />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <label
            className="tt tt-above flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 font-sans text-[11px] text-fg-subtle hover:bg-bg-muted hover:text-fg"
            data-tip="Attach document (pdf, docx, xlsx, pptx, md, txt, csv)"
          >
            <FilePlus className="h-3.5 w-3.5" />
            <input
              type="file"
              accept={DOC_EXTENSIONS}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => setArtifactsEnabled((v) => !v)}
            className={cn(
              "tt tt-above flex items-center gap-1 rounded px-1.5 py-1 font-sans text-[11px] hover:bg-bg-muted",
              artifactsEnabled
                ? "text-accent"
                : "text-fg-subtle hover:text-fg",
            )}
            data-tip={
              artifactsEnabled
                ? "Artifact mode on — reply as a React artifact"
                : "Artifact mode off"
            }
            aria-pressed={artifactsEnabled}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            ref={templateBtnRef}
            onClick={() => setShowTemplatePicker((v) => !v)}
            className={cn(
              "tt tt-above flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-1 font-sans text-[11px] hover:bg-bg-muted",
              activeTemplate
                ? "text-accent"
                : "text-fg-subtle hover:text-fg",
            )}
            data-tip={
              activeTemplate
                ? "Template active — response will render structured"
                : "Use a response template"
            }
            aria-pressed={!!activeTemplate}
            aria-expanded={showTemplatePicker}
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
          </button>
          {showTemplatePicker &&
            templateCoords &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={templateMenuRef}
                style={{
                  position: "fixed",
                  bottom: templateCoords.bottom,
                  left: templateCoords.left,
                  width: "min(20rem, calc(100vw - 1.5rem))",
                }}
                className="z-50 rounded-lg border border-border bg-bg-elev p-1.5 shadow-lg"
              >
                <div className="byline px-2 pb-1.5 pt-1">
                  response templates
                </div>
                <div className="flex flex-col">
                  {TEMPLATE_META.map((t) => {
                    const active = activeTemplate === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setActiveTemplate(active ? null : t.id);
                          setShowTemplatePicker(false);
                        }}
                        className={cn(
                          "flex items-start gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors",
                          active
                            ? "bg-accent-soft/60"
                            : "hover:bg-bg-muted",
                        )}
                      >
                        <span className="mt-[1px] text-[16px]" aria-hidden>
                          {t.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-sans text-[12.5px] font-medium text-fg">
                              {t.name}
                            </span>
                            {active && (
                              <span className="font-mono text-[9.5px] uppercase tracking-wider text-accent">
                                active
                              </span>
                            )}
                          </div>
                          <div className="font-serif text-[11.5px] italic text-fg-muted">
                            {t.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 border-t border-border px-2 py-1.5 font-serif text-[11px] italic text-fg-subtle">
                  applies to the next message only
                </div>
              </div>,
              document.body,
            )}
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={transcribing}
            className={cn(
              "tt tt-above flex items-center gap-1 rounded px-1.5 py-1 font-sans text-[11px] hover:bg-bg-muted disabled:opacity-50",
              recording
                ? "animate-pulse text-red-500"
                : transcribing
                  ? "text-fg-subtle"
                  : "text-fg-subtle hover:text-fg",
            )}
            data-tip={
              recording
                ? "Recording — click to stop"
                : transcribing
                  ? "Transcribing…"
                  : "Dictate (click to record)"
            }
            aria-pressed={recording}
          >
            {transcribing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onAutoSpeakToggle}
            className={cn(
              "tt tt-above flex items-center gap-1 rounded px-1.5 py-1 font-sans text-[11px] hover:bg-bg-muted",
              autoSpeak ? "text-accent" : "text-fg-subtle hover:text-fg",
            )}
            data-tip={
              autoSpeak
                ? "Auto-speak replies on"
                : "Auto-speak replies off"
            }
            aria-pressed={autoSpeak}
          >
            {autoSpeak ? (
              <Volume2 className="h-3.5 w-3.5" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
          </button>
          </div>
          {streaming ? (
            <button
              onClick={onAbort}
              className="flex flex-shrink-0 items-center gap-1 rounded border border-border px-2.5 py-1 font-sans text-[11px] text-fg-muted hover:text-red-500"
            >
              <X className="h-3 w-3" />
              Stop
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={
                (!input.trim() && attachments.length === 0) || uploading > 0
              }
              className="flex flex-shrink-0 items-center gap-1 rounded bg-accent px-3 py-1.5 font-sans text-[11.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
          )}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 px-1 font-sans text-[10.5px] text-fg-subtle">
          <span>⌘/Ctrl ↵ to send · drag or paste images · ⎋ to stop</span>
          {slashNote && (
            <span className="truncate font-mono text-accent">{slashNote}</span>
          )}
        </div>
      </div>
    </div>
  );
}

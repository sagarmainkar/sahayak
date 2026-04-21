"use client";

import { useRef, useState } from "react";
import {
  Paperclip,
  Send,
  X,
  Loader2,
  Sparkles,
  Mic,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { MEMORY_TYPES, type MemoryType, type MsgAttachment } from "@/lib/types";

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
  ) => void;
  onAbort: () => void;
  autoSpeak: boolean;
  onAutoSpeakToggle: () => void;
};

async function uploadOne(file: File): Promise<MsgAttachment | null> {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const r = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      attachment: { mimeType: string; url: string };
    };
    const name = j.attachment.url.split("/").pop() ?? "";
    return { type: "image", mimeType: j.attachment.mimeType, filename: name };
  } catch {
    return null;
  }
}

export function Composer({
  assistantName,
  streaming,
  onSend,
  onAbort,
  autoSpeak,
  onAutoSpeakToggle,
}: Props) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<MsgAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  // Session-sticky: stays on across turns until toggled off.
  const [artifactsEnabled, setArtifactsEnabled] = useState(false);
  const [slashNote, setSlashNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function flashNote(msg: string, ms = 2500) {
    setSlashNote(msg);
    setTimeout(() => setSlashNote((cur) => (cur === msg ? null : cur)), ms);
  }

  async function startRecording() {
    if (recording || transcribing) return;
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

    onSend(text, attachments, artifactsEnabled);
    clear();
  }

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    setUploading((n) => n + arr.length);
    const results = await Promise.all(arr.map(uploadOne));
    setAttachments((prev) => [
      ...prev,
      ...results.filter((r): r is MsgAttachment => !!r),
    ]);
    setUploading((n) => n - arr.length);
  }

  function srcFor(a: MsgAttachment): string {
    if (a.filename) return `/api/attachment/${a.filename}`;
    if (a.data) return `data:${a.mimeType};base64,${a.data}`;
    return "";
  }

  return (
    <div className="border-t border-border bg-bg-elev px-4 py-3">
      <div className="mx-auto max-w-[74ch]">
        {(attachments.length > 0 || uploading > 0) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative">
                <img
                  src={srcFor(a)}
                  alt=""
                  className="h-16 w-16 rounded border border-border object-cover"
                />
                <button
                  onClick={() =>
                    setAttachments((p) => p.filter((_, k) => k !== i))
                  }
                  className="absolute -right-1 -top-1 rounded-full bg-bg p-0.5 text-fg-muted hover:text-fg"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {uploading > 0 && (
              <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-border">
                <Loader2 className="h-4 w-4 animate-spin text-fg-subtle" />
              </div>
            )}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg border border-border bg-bg px-3 py-2 focus-within:border-accent">
          <label
            className="tt tt-above flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 font-sans text-[11px] text-fg-subtle hover:bg-bg-muted hover:text-fg"
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
          <textarea
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
            className="flex-1 resize-none border-0 bg-transparent font-serif text-[15px] leading-relaxed text-fg placeholder:italic placeholder:text-fg-subtle focus:outline-none"
          />
          {streaming ? (
            <button
              onClick={onAbort}
              className="flex items-center gap-1 rounded border border-border px-2.5 py-1 font-sans text-[11px] text-fg-muted hover:text-red-500"
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
              className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 font-sans text-[11.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
          )}
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

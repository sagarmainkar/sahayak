"use client";

import { useState } from "react";
import { Paperclip, Send, X, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MsgAttachment } from "@/lib/types";

type Props = {
  assistantName: string;
  streaming: boolean;
  onSend: (
    text: string,
    attachments: MsgAttachment[],
    artifactsEnabled: boolean,
  ) => void;
  onAbort: () => void;
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

export function Composer({ assistantName, streaming, onSend, onAbort }: Props) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<MsgAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  // Session-sticky: stays on across turns until toggled off.
  const [artifactsEnabled, setArtifactsEnabled] = useState(false);

  function clear() {
    setInput("");
    setAttachments([]);
  }

  function submit() {
    if (streaming || uploading > 0) return;
    if (!input.trim() && attachments.length === 0) return;
    onSend(input.trim(), attachments, artifactsEnabled);
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
        <div className="mt-1 px-1 font-sans text-[10.5px] text-fg-subtle">
          ⌘/Ctrl ↵ to send · drag or paste images · ⎋ to stop
        </div>
      </div>
    </div>
  );
}

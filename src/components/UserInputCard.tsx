"use client";

import { useState } from "react";
import { MessageCircleQuestion, Send } from "lucide-react";
import { Markdown } from "./Markdown";

export function UserInputCard({
  question,
  options,
  onRespond,
}: {
  question: string;
  options: string[];
  onRespond: (answer: string) => void;
}) {
  const [custom, setCustom] = useState("");

  return (
    <div className="mx-auto w-full max-w-[74ch] pl-4">
      <div className="my-2 overflow-hidden rounded-md border border-accent/40 bg-accent/5 not-prose">
        <div className="flex items-center gap-2 border-b border-accent/30 bg-accent/10 px-3 py-1.5 font-sans text-[11px] text-accent">
          <MessageCircleQuestion className="h-3.5 w-3.5" />
          <span className="font-medium">Input needed</span>
        </div>
        <div className="px-3 py-3">
          <div className="prose text-[14px] leading-relaxed">
            <Markdown text={question} />
          </div>
          {options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => onRespond(opt)}
                  className="rounded-full border border-border bg-bg px-3 py-1.5 font-sans text-[12px] text-fg hover:border-accent hover:bg-accent/10"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) {
                  e.preventDefault();
                  onRespond(custom.trim());
                }
              }}
              placeholder="Type a custom answer…"
              autoFocus
              className="min-w-0 flex-1 rounded border border-border bg-bg px-2.5 py-1.5 font-serif text-[13px] text-fg placeholder:italic placeholder:text-fg-subtle focus:border-accent focus:outline-none"
            />
            <button
              onClick={() => custom.trim() && onRespond(custom.trim())}
              disabled={!custom.trim()}
              className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 font-sans text-[11.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-3 w-3" />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

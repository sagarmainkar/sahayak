"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

export function Thinking({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(streaming);
  if (!text) return null;
  const words = text.trim().split(/\s+/).length;
  return (
    <div className="my-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="byline flex items-center gap-1 hover:text-fg"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        thinking · {words} {words === 1 ? "word" : "words"}
      </button>
      {open && <div className="marginalia mt-2">{text}</div>}
    </div>
  );
}

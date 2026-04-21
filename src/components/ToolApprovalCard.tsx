"use client";

import { ShieldAlert, Check, CheckCheck, X } from "lucide-react";

export function ToolApprovalCard({
  toolName,
  args,
  onApproveOnce,
  onApproveSession,
  onDeny,
}: {
  toolName: string;
  args: Record<string, unknown>;
  onApproveOnce: () => void;
  onApproveSession: () => void;
  onDeny: () => void;
}) {
  const pretty = JSON.stringify(args, null, 2);
  const preview = pretty.length > 1200 ? pretty.slice(0, 1200) + "\n…" : pretty;
  return (
    <div className="mx-auto w-full max-w-[74ch] pl-4">
      <div className="my-2 overflow-hidden rounded-md border border-amber-500/40 bg-amber-500/5 not-prose">
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 font-sans text-[11px] text-amber-700 dark:text-amber-400">
          <ShieldAlert className="h-3.5 w-3.5" />
          <span className="font-medium">Approval required</span>
          <span className="font-mono text-[11px]">· {toolName}</span>
        </div>
        <pre className="max-h-60 overflow-auto p-3 font-mono text-[11.5px] leading-[1.5] text-fg">
          {preview}
        </pre>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-amber-500/20 bg-bg-paper px-3 py-2">
          <button
            onClick={onApproveOnce}
            className="flex items-center gap-1 rounded border border-border bg-bg px-2.5 py-1 font-sans text-[11.5px] text-fg hover:border-accent hover:bg-accent/10"
          >
            <Check className="h-3 w-3" />
            Approve once
          </button>
          <button
            onClick={onApproveSession}
            className="flex items-center gap-1 rounded border border-border bg-bg px-2.5 py-1 font-sans text-[11.5px] text-fg hover:border-accent hover:bg-accent/10"
          >
            <CheckCheck className="h-3 w-3" />
            Approve for session
          </button>
          <button
            onClick={onDeny}
            className="flex items-center gap-1 rounded border border-border bg-bg px-2.5 py-1 font-sans text-[11.5px] text-red-500 hover:border-red-500 hover:bg-red-500/5"
          >
            <X className="h-3 w-3" />
            Deny
          </button>
          <span className="ml-auto font-sans text-[10.5px] text-fg-subtle">
            Session-wide approvals reset when you close the tab.
          </span>
        </div>
      </div>
    </div>
  );
}

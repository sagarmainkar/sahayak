"use client";

import { useMemo, useState } from "react";
import {
  Wrench, CheckCircle2, XCircle, ChevronDown, Loader2,
  Search, Mail, FolderOpen, Terminal, Globe,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { LinkCard } from "./LinkCard";

type Parsed =
  | { ok: boolean; [k: string]: unknown }
  | null;

function parse(content: string): Parsed {
  try {
    const o = JSON.parse(content);
    return typeof o === "object" && o !== null ? o : null;
  } catch {
    return null;
  }
}

function iconFor(name: string) {
  if (name.startsWith("web_search")) return Search;
  if (name.startsWith("web_fetch")) return Globe;
  if (name.startsWith("gmail")) return Mail;
  if (name.startsWith("list_directory") || name.startsWith("search_files"))
    return FolderOpen;
  if (name.startsWith("execute_command")) return Terminal;
  return Wrench;
}

function summaryFor(name: string, r: Parsed): string {
  if (!r) return "";
  if (name === "web_search" && Array.isArray(r.results)) {
    return `${(r.results as unknown[]).length} result(s)`;
  }
  if (name === "gmail_search" && Array.isArray(r.messages)) {
    return `${(r.messages as unknown[]).length} message(s)`;
  }
  if (name === "list_directory" && Array.isArray(r.entries)) {
    const n = (r.entries as unknown[]).length;
    return `${n} entr${n === 1 ? "y" : "ies"}`;
  }
  if (name === "search_files" && Array.isArray(r.matches)) {
    return `${(r.matches as unknown[]).length} match(es)`;
  }
  if (name === "execute_command") {
    const exit = r.exit_code as number | undefined;
    return typeof exit === "number" ? `exit ${exit}` : "";
  }
  if (name === "read_file" && typeof r.total_lines === "number") {
    return `${r.lines_returned}/${r.total_lines} lines`;
  }
  if (name === "write_file") {
    return r.action === "appended" ? "appended" : "written";
  }
  if (name === "path_exists") {
    return r.exists ? "exists" : "missing";
  }
  if (name === "web_fetch" && typeof r.title === "string") {
    return (r.title as string).slice(0, 60);
  }
  if (r.error && r.message) {
    return `${r.error}: ${r.message}`.slice(0, 80);
  }
  return "";
}

function StructuredResult({
  name,
  result,
}: {
  name: string;
  result: Parsed;
}) {
  if (!result) return null;

  if (name === "web_search" && Array.isArray(result.results)) {
    const rs = result.results as Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
    return (
      <div className="space-y-0.5 py-1">
        {rs.map(
          (r, i) => r.url && <LinkCard key={i} url={r.url} />
        )}
      </div>
    );
  }

  if (name === "gmail_search" && Array.isArray(result.messages)) {
    const ms = result.messages as Array<{
      date?: string;
      from?: string;
      subject?: string;
      snippet?: string;
      id?: string;
    }>;
    return (
      <div className="divide-y divide-border">
        {ms.map((m, i) => (
          <div key={i} className="py-1.5 first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-sans text-[11.5px] font-medium text-fg">
                {m.from?.split("<")[0].trim() || "?"}
              </span>
              <span className="flex-shrink-0 font-mono text-[10px] text-fg-subtle">
                {m.date?.slice(0, 16) ?? ""}
              </span>
            </div>
            <div className="mt-0.5 truncate font-serif text-[12.5px] italic text-fg-muted">
              {m.subject ?? "(no subject)"}
            </div>
            {m.snippet && (
              <div className="mt-0.5 line-clamp-1 font-serif text-[11.5px] text-fg-subtle">
                {m.snippet}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (name === "list_directory" && Array.isArray(result.entries)) {
    const entries = result.entries as Array<{
      name: string;
      type: string;
      size: number;
    }>;
    return (
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 font-mono text-[11.5px]">
        {entries.slice(0, 40).map((e, i) => (
          <div key={i} className="contents">
            <span className="text-fg-subtle">
              {e.type === "directory" ? "📁" : "📄"}
            </span>
            <span className="truncate text-fg">{e.name}</span>
            <span className="text-fg-subtle">
              {e.type === "file" ? `${e.size}b` : ""}
            </span>
          </div>
        ))}
        {entries.length > 40 && (
          <div className="col-span-3 mt-1 text-fg-subtle">
            … and {entries.length - 40} more
          </div>
        )}
      </div>
    );
  }

  if (name === "execute_command") {
    const stdout = (result.stdout as string) ?? "";
    const stderr = (result.stderr as string) ?? "";
    return (
      <div className="space-y-2">
        {stdout && (
          <div>
            <div className="mb-1 font-sans text-[10px] uppercase tracking-[0.15em] text-fg-subtle">
              stdout
            </div>
            <pre className="whitespace-pre-wrap rounded-sm border border-border bg-bg px-2 py-1.5 font-mono text-[11px] leading-snug text-fg">
              {stdout}
            </pre>
          </div>
        )}
        {stderr && (
          <div>
            <div className="mb-1 font-sans text-[10px] uppercase tracking-[0.15em] text-red-500/70">
              stderr
            </div>
            <pre className="whitespace-pre-wrap rounded-sm border border-red-900/30 bg-red-950/10 px-2 py-1.5 font-mono text-[11px] leading-snug text-red-500/80">
              {stderr}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (name === "read_file" && typeof result.content === "string") {
    return (
      <pre className="max-h-72 overflow-auto rounded-sm border border-border bg-bg px-2 py-1.5 font-mono text-[11px] leading-snug">
        {result.content}
      </pre>
    );
  }

  if (name === "web_fetch") {
    return (
      <div className="space-y-1.5">
        {result.title && (
          <div className="font-display text-[14px] italic text-fg">
            {String(result.title)}
          </div>
        )}
        <div className="font-serif text-[12px] text-fg-muted">
          {String(result.content ?? "").slice(0, 400)}
          {String(result.content ?? "").length > 400 && "…"}
        </div>
      </div>
    );
  }

  // fallback: raw JSON pretty-printed
  return (
    <pre className="max-h-64 overflow-auto rounded-sm border border-border bg-bg px-2 py-1.5 font-mono text-[10.5px] leading-snug text-fg-muted">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

export function ToolCard({
  name,
  args,
  content,
}: {
  name: string;
  args?: Record<string, unknown>;
  content: string;
}) {
  const [open, setOpen] = useState(false);
  const running = content === "(running…)" || content === "(dispatching)";
  const parsed = useMemo(() => (running ? null : parse(content)), [
    content, running,
  ]);
  const ok = parsed?.ok ?? undefined;
  const argPreview = args && Object.keys(args).length
    ? Object.entries(args)
        .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`)
        .join(" ")
        .slice(0, 100)
    : "";
  const summary = summaryFor(name, parsed);
  const Icon = iconFor(name);

  return (
    <div className="my-2 font-sans">
      <button
        onClick={() => !running && setOpen((v) => !v)}
        disabled={running}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm border px-2.5 py-1.5 text-left text-[12px] transition-colors",
          "border-border bg-bg-paper hover:border-border-strong",
          running && "cursor-wait",
        )}
      >
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-fg-subtle" />
        <span className="font-mono text-[11.5px] text-fg">{name}</span>
        {argPreview && (
          <span className="truncate font-mono text-[10.5px] text-fg-subtle">
            {argPreview}
          </span>
        )}
        <span className="ml-auto flex flex-shrink-0 items-center gap-2 text-fg-muted">
          {summary && !running && (
            <span className="font-serif text-[11.5px] italic">
              {summary}
            </span>
          )}
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          ) : ok === false ? (
            <XCircle className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          )}
          {!running && (
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform",
                open && "rotate-180",
              )}
            />
          )}
        </span>
      </button>
      {open && !running && (
        <div className="mt-1 rounded-sm border border-border bg-bg-paper px-2.5 py-2">
          {parsed ? (
            <StructuredResult name={name} result={parsed} />
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-[11px] text-fg-muted">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

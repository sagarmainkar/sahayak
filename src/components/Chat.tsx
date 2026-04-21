"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Plus, Pencil, Trash2, Archive, Wrench, PanelLeft, Download,
  RotateCcw,
} from "lucide-react";
import { Markdown } from "./Markdown";
import { ThemeToggle } from "./ThemeToggle";
import { StyleSwitcher } from "./StyleSwitcher";
import { CapabilityPills } from "./CapabilityPills";
import { Thinking } from "./Thinking";
import { ToolCard } from "./ToolCard";
import { Composer } from "./Composer";
import { ArtifactPanel } from "./ArtifactPanel";
import { useArtifactPanel } from "./ArtifactPanelContext";
import { cn } from "@/lib/cn";
import { fmtTokens } from "@/lib/fmt";
import type {
  Assistant, ChatMessage, ModelInfo, MsgAttachment, Session, ToolPublic,
} from "@/lib/types";

type Props = { assistantId: string; sessionId?: string };

function uid() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}

const Turn = memo(function Turn({
  m,
  streaming = false,
  assistant,
  onRedo,
  sessionId,
}: {
  m: ChatMessage;
  streaming?: boolean;
  assistant: Assistant;
  onRedo?: () => void;
  sessionId?: string | null;
}) {
  if (m.role === "tool") {
    return (
      <div className="mx-auto w-full max-w-[74ch] pl-4">
        <ToolCard name={m.toolName ?? "tool"} content={m.content} />
      </div>
    );
  }

  if (m.role === "system") {
    return (
      <div className="mx-auto w-full max-w-[74ch]">
        <div className="rounded-sm border-l-2 border-accent bg-bg-paper/60 px-4 py-3">
          <div className="byline mb-1">note</div>
          <div className="whitespace-pre-wrap font-serif text-[13.5px] italic text-fg-muted">
            {m.content}
          </div>
        </div>
      </div>
    );
  }

  const isUser = m.role === "user";

  if (isUser) {
    return (
      <article className="bloom mx-auto flex w-full max-w-[74ch] flex-col items-end">
        <div className="byline mb-1.5">you</div>
        {m.attachments && m.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap justify-end gap-2">
            {m.attachments.map((a, i) => (
              <img
                key={i}
                src={a.filename ? `/api/attachment/${a.filename}` : `data:${a.mimeType};base64,${a.data}`}
                alt=""
                className="max-h-56 rounded border border-user-border"
              />
            ))}
          </div>
        )}
        <div className="group flex items-start gap-1.5">
          {onRedo && (
            <button
              onClick={onRedo}
              className="tt mt-1 rounded p-1 text-fg-subtle opacity-0 transition-opacity hover:bg-bg-muted hover:text-fg group-hover:opacity-100"
              data-tip="Regenerate response"
              aria-label="Regenerate"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          {m.content && (
            <div className="user-bubble max-w-[60ch]">{m.content}</div>
          )}
        </div>
      </article>
    );
  }

  return (
    <article className="bloom mx-auto w-full max-w-[74ch]">
      <header className="mb-2 flex items-baseline gap-2">
        <span
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm text-[13px]"
          style={{
            background: `${assistant.color}22`,
            color: assistant.color,
          }}
        >
          {assistant.emoji}
        </span>
        <div className="byline-display">{assistant.name}</div>
      </header>

      <div className="assistant-edge">
        {m.thinking && (
          <Thinking text={m.thinking} streaming={streaming && !m.content} />
        )}

        {m.content ? (
          <div className={streaming ? "caret" : ""}>
            <Markdown
              text={m.content}
              sessionId={sessionId}
              assistantId={assistant.id}
            />
          </div>
        ) : streaming && !m.thinking ? (
          <div className="font-serif text-[14px] italic text-fg-subtle">
            composing…
          </div>
        ) : null}
      </div>
    </article>
  );
});

export default function Chat({ assistantId, sessionId: initialSessionId }: Props) {
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [allTools, setAllTools] = useState<ToolPublic[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [ctx, setCtx] = useState({ prompt: 0, completion: 0 });
  const [toolOverride, setToolOverride] = useState<string[] | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamingRef = useRef(false);
  const localSessionRef = useRef<string | null>(null);
  const { openId: artifactOpenId } = useArtifactPanel();

  const enabledTools = toolOverride ?? assistant?.enabledTools ?? [];
  const activeModel = assistant?.model ?? "";
  const currentModel = models.find((m) => m.name === activeModel);

  useEffect(() => {
    fetch(`/api/assistants/${assistantId}`)
      .then((r) => r.json())
      .then((d: { assistant: Assistant }) => {
        setAssistant(d.assistant);
        setToolOverride(null);
      });
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: { models: ModelInfo[] }) => setModels(d.models));
    fetch("/api/tools")
      .then((r) => r.json())
      .then((d: { tools: ToolPublic[] }) => setAllTools(d.tools));
  }, [assistantId]);

  const loadSessions = useCallback(async () => {
    const r = await fetch(`/api/sessions?assistantId=${assistantId}`);
    const d = (await r.json()) as { sessions: Session[] };
    setSessions(d.sessions);
  }, [assistantId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!sessionId) {
      if (!streamingRef.current) {
        setMessages([]);
        setCtx({ prompt: 0, completion: 0 });
      }
      return;
    }
    // If we just created this session mid-stream, don't blow away our
    // in-progress in-memory messages with the empty server copy.
    if (streamingRef.current || localSessionRef.current === sessionId) {
      return;
    }
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((d: { session: Session }) => {
        setMessages(d.session.messages ?? []);
        setCtx({
          prompt: d.session.promptTokens,
          completion: d.session.completionTokens,
        });
      });
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, streaming]);

  const ctxMax = currentModel?.contextLength ?? null;
  const ctxPct = ctxMax ? Math.min(100, (ctx.prompt / ctxMax) * 100) : 0;
  const ctxClass =
    ctxPct < 60 ? "bg-emerald-500" : ctxPct < 85 ? "bg-amber-500" : "bg-red-500";

  async function ensureSession(firstUserMsg: string): Promise<string> {
    if (sessionId) return sessionId;
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assistantId,
        title: firstUserMsg.slice(0, 60),
        messages: [],
      }),
    });
    const d = (await r.json()) as { session: Session };
    localSessionRef.current = d.session.id; // prevent effect from reloading
    setSessionId(d.session.id);
    loadSessions();
    window.history.replaceState(null, "", `/chat/${assistantId}/${d.session.id}`);
    return d.session.id;
  }

  async function persist(
    sid: string,
    msgs: ChatMessage[],
    tokens: { prompt: number; completion: number },
  ) {
    await fetch(`/api/sessions/${sid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: msgs,
        promptTokens: tokens.prompt,
        completionTokens: tokens.completion,
      }),
    });
  }

  async function handleSend(text: string, attachments: MsgAttachment[]) {
    if (streaming) return;
    if (!assistant) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      attachments: attachments.length ? attachments : undefined,
      createdAt: Date.now(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setStreaming(true);
    streamingRef.current = true;

    const sid = await ensureSession(text || "(image)");

    const assembled: ChatMessage[] = [...nextMessages];
    let curIndex = -1;
    const startNewAssistant = () => {
      const a: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        thinking: "",
        createdAt: Date.now(),
      };
      assembled.push(a);
      curIndex = assembled.length - 1;
      setMessages([...assembled]);
    };
    const patchCur = (patch: Partial<ChatMessage>) => {
      if (curIndex < 0) return;
      assembled[curIndex] = { ...assembled[curIndex], ...patch };
      setMessages([...assembled]);
    };
    startNewAssistant();

    const payload = {
      model: activeModel,
      system: assistant.systemPrompt,
      messages: nextMessages.map((m) => ({
        role: m.role,
        content: m.content,
        thinking: m.thinking,
        toolCalls: m.toolCalls,
        toolName: m.toolName,
        attachments: m.attachments,
      })),
      think: assistant.thinkMode === "off" ? false : assistant.thinkMode,
      enabledTools,
    };

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      if (!res.body) throw new Error("no body");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let lastTokens = { prompt: 0, completion: 0 };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const line = ev.replace(/^data:\s?/, "");
          if (!line.trim() || line === "[DONE]") continue;
          let obj: Record<string, unknown>;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          const t = obj.type as string;
          if (t === "content") {
            const cur = assembled[curIndex];
            patchCur({ content: cur.content + String(obj.delta ?? "") });
          } else if (t === "thinking") {
            const cur = assembled[curIndex];
            patchCur({
              thinking: (cur.thinking ?? "") + String(obj.delta ?? ""),
            });
          } else if (t === "done_turn") {
            lastTokens = {
              prompt: Number(obj.promptTokens ?? 0),
              completion: Number(obj.completionTokens ?? 0),
            };
            setCtx(lastTokens);
          } else if (t === "assistant_message") {
            const cur = assembled[curIndex];
            patchCur({
              content:
                obj.content !== undefined
                  ? String(obj.content)
                  : cur.content,
              thinking:
                obj.thinking !== undefined
                  ? String(obj.thinking)
                  : cur.thinking,
              toolCalls: obj.toolCalls as ChatMessage["toolCalls"],
            });
          } else if (t === "tool_call") {
            assembled.push({
              id: uid(),
              role: "tool",
              content: "(running…)",
              toolName: String(obj.name ?? ""),
              createdAt: Date.now(),
            });
            setMessages([...assembled]);
          } else if (t === "tool_result") {
            for (let i = assembled.length - 1; i >= 0; i--) {
              if (assembled[i].role === "tool") {
                assembled[i] = {
                  ...assembled[i],
                  content: String(obj.summary ?? ""),
                };
                break;
              }
            }
            setMessages([...assembled]);
            startNewAssistant();
          } else if (t === "error") {
            const cur = assembled[curIndex];
            patchCur({
              content:
                cur.content + `\n\n**error:** ${String(obj.message ?? "")}`,
            });
          }
        }
      }

      while (assembled.length) {
        const last = assembled[assembled.length - 1];
        const empty =
          last.role === "assistant" &&
          !last.content &&
          !last.thinking &&
          (!last.toolCalls || last.toolCalls.length === 0);
        if (!empty) break;
        assembled.pop();
      }
      setMessages([...assembled]);
      await persist(sid, assembled, lastTokens);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            content: `**error:** ${(e as Error).message}`,
            createdAt: Date.now(),
          },
        ]);
      }
    } finally {
      setStreaming(false);
      streamingRef.current = false;
      abortRef.current = null;
      loadSessions();
    }
  }

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  async function redoLastUser() {
    if (streaming) return;
    // find last user message
    let idx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    const last = messages[idx];
    // truncate to just before the user message
    const trimmed = messages.slice(0, idx);
    setMessages(trimmed);
    // replay with the original content + attachments
    await handleSend(last.content, last.attachments ?? []);
  }

  async function newSession() {
    setSessionId(null);
    setMessages([]);
    setCtx({ prompt: 0, completion: 0 });
    window.history.replaceState(null, "", `/chat/${assistantId}`);
  }

  async function deleteSession(id: string) {
    if (!confirm("Delete this chat?")) return;
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (sessionId === id) newSession();
    loadSessions();
  }

  async function compact() {
    if (!sessionId || messages.length < 6) return;
    if (!confirm("Summarise older messages into a single note?")) return;
    const keep = messages.slice(-4);
    const older = messages.slice(0, messages.length - 4);
    const summary = older
      .filter((m) => m.role !== "tool")
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n\n")
      .slice(0, 6000);
    const summariserModel =
      models.find((m) => m.name.includes("9b_128k"))?.name ?? activeModel;
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: summariserModel,
        system:
          "Summarise the chat history into a concise bullet list: key facts, decisions, open questions. Preserve names/IDs. ≤12 bullets.",
        messages: [{ role: "user", content: summary }],
        think: false,
      }),
    });
    if (!r.body) return;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const ev of events) {
        const line = ev.replace(/^data:\s?/, "");
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "content") text += obj.delta;
        } catch {}
      }
    }
    const compactMsg: ChatMessage = {
      id: uid(),
      role: "system",
      content: `[Earlier conversation summarised]\n${text}`,
      createdAt: Date.now(),
    };
    const next = [compactMsg, ...keep];
    setMessages(next);
    await persist(sessionId, next, ctx);
  }

  async function onDropFiles(files: FileList) {
    // Forward drops to Composer via a synthetic event — but Composer owns input now.
    // For simplicity in the drop overlay, we re-dispatch through an input
    const el = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept="image/*"]',
    );
    if (!el) return;
    const dt = new DataTransfer();
    Array.from(files).forEach((f) => dt.items.add(f));
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (!assistant) {
    return (
      <div className="flex h-screen items-center justify-center font-serif italic text-fg-muted">
        loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-bg text-fg">
      {/* sessions sidebar */}
      {showSidebar && (
        <aside className="flex w-60 flex-col border-r border-border bg-bg-elev">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Link
              href="/"
              className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
              data-tip="Home"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-base"
              style={{
                background: `${assistant.color}22`,
                color: assistant.color,
              }}
            >
              {assistant.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-[14px] font-medium leading-tight text-fg">
                {assistant.name}
              </div>
              <div className="truncate font-mono text-[10px] text-fg-subtle">
                {assistant.model}
              </div>
            </div>
            <Link
              href={`/assistants/${assistant.id}`}
              className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
              data-tip="Edit assistant"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Link>
          </div>
          <button
            onClick={newSession}
            className="mx-2 mt-2 flex items-center gap-2 rounded border border-dashed border-border px-3 py-2 font-sans text-[12px] text-fg-muted hover:border-accent hover:text-fg"
          >
            <Plus className="h-3.5 w-3.5" />
            New chat
          </button>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {sessions.length === 0 && (
              <div className="px-2 py-4 text-center font-serif text-[12px] italic text-fg-subtle">
                no chats yet
              </div>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "group flex items-center gap-1 rounded px-2 py-1.5 font-serif text-[13px]",
                  s.id === sessionId
                    ? "bg-bg-muted text-fg"
                    : "text-fg-muted hover:bg-bg-muted/70 hover:text-fg",
                )}
              >
                <button
                  onClick={() => {
                    setSessionId(s.id);
                    window.history.replaceState(
                      null, "", `/chat/${assistantId}/${s.id}`,
                    );
                  }}
                  className="flex-1 truncate text-left"
                >
                  {s.title || "Untitled"}
                </button>
                {(s.promptTokens + s.completionTokens) > 0 && (
                  <span className="ml-1 flex-shrink-0 font-mono text-[9.5px] tabular-nums text-fg-subtle group-hover:hidden">
                    {fmtTokens(s.promptTokens + s.completionTokens)}
                  </span>
                )}
                <a
                  href={`/api/sessions/${s.id}/export`}
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Export"
                  title="Export as markdown"
                >
                  <Download className="h-3 w-3 text-fg-subtle hover:text-accent" />
                </a>
                <button
                  onClick={() => deleteSession(s.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Delete"
                >
                  <Trash2 className="h-3 w-3 text-fg-subtle hover:text-red-500" />
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* main column */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-bg-elev px-4 py-2">
          <button
            onClick={() => setShowSidebar((v) => !v)}
            className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
            aria-label="Toggle sidebar"
            data-tip="Sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <div
            className="tt rounded-sm bg-bg-paper px-2 py-1 font-mono text-[11px] text-fg-muted"
            data-tip="Model is set in the assistant editor"
          >
            {activeModel}
          </div>
          <CapabilityPills model={currentModel} />
          {ctxMax && (
            <div
              className="tt ml-2 flex items-center gap-2 font-mono text-[11px] text-fg-muted"
              data-tip={`Context: ${ctx.prompt.toLocaleString()} / ${ctxMax.toLocaleString()} tokens`}
            >
              <div className="h-1 w-32 overflow-hidden rounded-full bg-bg-muted">
                <div
                  className={cn("h-full transition-all", ctxClass)}
                  style={{ width: `${ctxPct}%` }}
                />
              </div>
              <span className="tabular-nums">
                {ctx.prompt.toLocaleString()}/{ctxMax.toLocaleString()}
              </span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            <a
              href={sessionId ? `/api/sessions/${sessionId}/export` : undefined}
              className={cn(
                "tt flex items-center gap-1 rounded border border-border px-2 py-1 font-sans text-[11px]",
                sessionId
                  ? "text-fg-muted hover:text-fg"
                  : "pointer-events-none opacity-40 text-fg-muted",
              )}
              data-tip="Export chat as Markdown"
              download
            >
              <Download className="h-3 w-3" />
              Export
            </a>
            <button
              onClick={compact}
              disabled={!sessionId || messages.length < 6}
              className="tt flex items-center gap-1 rounded border border-border px-2 py-1 font-sans text-[11px] text-fg-muted hover:text-fg disabled:opacity-40"
              data-tip="Summarise older messages"
            >
              <Archive className="h-3 w-3" />
              Compact
            </button>
            <button
              onClick={() => setShowTools((v) => !v)}
              className={cn(
                "tt flex items-center gap-1 rounded border px-2 py-1 font-sans text-[11px]",
                showTools
                  ? "border-accent bg-accent/10 text-fg"
                  : "border-border text-fg-muted hover:text-fg",
              )}
              data-tip="Toggle tool panel"
            >
              <Wrench className="h-3 w-3" />
              Tools · {enabledTools.length}
            </button>
            <StyleSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div
            ref={scrollRef}
            className="relative flex-1 overflow-y-auto"
            onDragEnter={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files.length) onDropFiles(e.dataTransfer.files);
            }}
          >
            {isDragging && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-accent bg-bg/80 font-display text-lg italic text-accent">
                drop images to attach
              </div>
            )}

            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div
                  className="mb-5 flex h-16 w-16 items-center justify-center rounded-full text-3xl"
                  style={{
                    background: `${assistant.color}22`,
                    color: assistant.color,
                  }}
                >
                  {assistant.emoji}
                </div>
                <h1
                  className="font-display text-[28px] text-fg"
                  style={{
                    fontVariationSettings: '"opsz" 144, "SOFT" 40',
                    fontStyle: "italic",
                  }}
                >
                  {assistant.name}
                </h1>
                <p className="byline mt-1">{assistant.model}</p>
                {assistant.systemPrompt && (
                  <p className="mt-4 max-w-md font-serif text-[14px] italic leading-relaxed text-fg-muted">
                    {assistant.systemPrompt.split("\n")[0]}
                  </p>
                )}
              </div>
            )}

            <div className="px-6 py-10 sm:px-10">
              {(() => {
                const lastUserIdx = (() => {
                  for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i].role === "user") return i;
                  }
                  return -1;
                })();
                return messages.map((m, i) => (
                  <div key={m.id}>
                    <Turn
                      m={m}
                      assistant={assistant}
                      sessionId={sessionId}
                      streaming={
                        streaming &&
                        i === messages.length - 1 &&
                        m.role === "assistant"
                      }
                      onRedo={
                        !streaming && i === lastUserIdx
                          ? redoLastUser
                          : undefined
                      }
                    />
                    {i < messages.length - 1 && <hr className="turn-rule" />}
                  </div>
                ));
              })()}
            </div>
          </div>

          {artifactOpenId ? (
            <ArtifactPanel />
          ) : showTools && (
            <aside className="w-72 overflow-y-auto border-l border-border bg-bg-elev p-3">
              <div className="byline mb-2">tools</div>
              {Object.entries(
                allTools.reduce<Record<string, ToolPublic[]>>((acc, t) => {
                  (acc[t.group] ??= []).push(t);
                  return acc;
                }, {}),
              ).map(([g, list]) => (
                <div key={g} className="mb-3">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-subtle">
                    {g}
                  </div>
                  <div className="space-y-1">
                    {list.map((t) => {
                      const on = enabledTools.includes(t.name);
                      return (
                        <label
                          key={t.name}
                          className={cn(
                            "flex cursor-pointer items-start gap-2 rounded border p-1.5 text-[11.5px]",
                            on
                              ? "border-accent bg-accent/10"
                              : "border-border hover:bg-bg-muted",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-accent"
                            checked={on}
                            onChange={() => {
                              const cur = enabledTools;
                              setToolOverride(
                                on
                                  ? cur.filter((n) => n !== t.name)
                                  : [...cur, t.name],
                              );
                            }}
                          />
                          <div>
                            <div className="font-mono font-medium text-fg">
                              {t.name}
                            </div>
                            <div className="font-serif text-[11.5px] text-fg-muted">
                              {t.description}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              {toolOverride && (
                <button
                  onClick={() => setToolOverride(null)}
                  className="w-full rounded border border-border px-2 py-1 font-sans text-[11px] text-fg-muted hover:text-fg"
                >
                  reset to assistant defaults
                </button>
              )}
            </aside>
          )}
        </div>

        <Composer
          assistantName={assistant.name}
          streaming={streaming}
          onSend={handleSend}
          onAbort={handleAbort}
        />
      </div>
    </div>
  );
}

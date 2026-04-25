"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Plus, Pencil, Trash2, Wrench, PanelLeft, Download,
  RotateCcw, Loader2, Pin, FileText, Search, X as XIcon, ArrowRight,
} from "lucide-react";
import { Markdown } from "./Markdown";
import { ThemeToggle } from "./ThemeToggle";
import { StyleSwitcher } from "./StyleSwitcher";
import { useConfirm } from "./ConfirmDialog";
import { CapabilityPills } from "./CapabilityPills";
import { Thinking } from "./Thinking";
import { TurnTimeline } from "./TurnTimeline";
import type { TurnTimeline as TTimeline } from "@/lib/types";
import { ContextPie } from "./ContextPie";
import { TEMPLATES_BY_ID } from "@/lib/templates";
import { ToolCard } from "./ToolCard";
import { Composer } from "./Composer";
import { ArtifactPanel } from "./ArtifactPanel";
import { ToolApprovalCard } from "./ToolApprovalCard";
import { useArtifactPanel } from "./ArtifactPanelContext";
import { cn } from "@/lib/cn";
import { fmtTokens } from "@/lib/fmt";
import type {
  Assistant, ChatMessage, ModelInfo, MsgAttachment, Session, ToolPublic,
} from "@/lib/types";

type Props = { assistantId: string; sessionId?: string };

/** One /api/search result. Shape matches the endpoint's payload. */
type SearchHit = {
  sessionId: string;
  assistantId: string;
  title: string;
  updatedAt: number;
  matchCount: number;
  matches: {
    role: "user" | "assistant" | "tool" | "system";
    snippet: string;
    matchStart: number;
    matchLen: number;
  }[];
};

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
  onContinue,
  sessionId,
  onArtifactAutoFix,
}: {
  m: ChatMessage;
  streaming?: boolean;
  assistant: Assistant;
  onRedo?: () => void;
  /** When provided, renders a Continue button below the assistant
   *  turn. Highlighted differently when the model stopped because
   *  it ran out of token budget (stopReason === "length"). */
  onContinue?: () => void;
  sessionId?: string | null;
  onArtifactAutoFix?: (error: string) => void;
}) {
  if (m.role === "tool") {
    return (
      <div className="mx-auto w-full max-w-[74ch] pl-4">
        <ToolCard
          name={m.toolName ?? "tool"}
          args={m.toolArgs}
          content={m.content}
        />
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
            {m.attachments.map((a, i) => {
              // Attachment URLs are session-scoped since the files live
              // under .data/<aid>/<sid>/uploads/ — we need both ids to
              // address them. Guard against the brief window where
              // sessionId isn't populated yet (happens only if a
              // pending user message renders before ensureSession
              // resolves — rare, the UI simply shows no preview).
              const attUrl = (filename: string) =>
                sessionId
                  ? `/api/attachment/${encodeURIComponent(assistant.id)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(filename)}`
                  : "#";
              if (a.type === "image") {
                return (
                  <img
                    key={i}
                    src={
                      a.filename
                        ? attUrl(a.filename)
                        : `data:${a.mimeType};base64,${a.data}`
                    }
                    alt=""
                    className="max-h-56 rounded border border-user-border"
                  />
                );
              }
              // document
              const ext = a.filename.split(".").pop() ?? "doc";
              return (
                <a
                  key={i}
                  href={attUrl(a.filename)}
                  download={a.originalName ?? a.filename}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded border border-user-border bg-user-bubble/40 px-2.5 py-1.5 text-[12px] text-fg hover:border-accent"
                  title={a.originalName ?? a.filename}
                >
                  <FileText className="h-3.5 w-3.5 text-fg-subtle" />
                  <span className="max-w-[18ch] truncate font-mono">
                    {a.originalName ?? a.filename}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
                    .{ext}
                  </span>
                </a>
              );
            })}
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
        {m.timeline && m.timeline.phases.length > 0 && (
          <TurnTimeline
            timeline={m.timeline}
            live={streaming}
            completionTokens={m.completionTokens}
          />
        )}
        {m.thinking && (
          <Thinking text={m.thinking} streaming={streaming && !m.content} />
        )}

        {m.content ? (
          <div className={streaming ? "caret" : ""}>
            <Markdown
              text={m.content}
              sessionId={sessionId}
              assistantId={assistant.id}
              streaming={streaming}
              onArtifactAutoFix={onArtifactAutoFix}
            />
          </div>
        ) : streaming && !m.thinking ? (
          <div className="font-serif text-[14px] italic text-fg-subtle">
            composing…
          </div>
        ) : null}

        {onContinue && !streaming && (
          <ContinueButton
            stopReason={m.stopReason}
            onClick={onContinue}
          />
        )}
      </div>
    </article>
  );
});

/** Tiny button rendered under the last assistant turn, nudging the
 *  model to keep going. When stopReason === "length" we know the
 *  reply was hard-cut by max_tokens, so the button is amber + more
 *  emphatic. Otherwise it's neutral and unobtrusive. */
function ContinueButton({
  stopReason,
  onClick,
}: {
  stopReason?: ChatMessage["stopReason"];
  onClick: () => void;
}) {
  const cutOff = stopReason === "length";
  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-sans text-[11.5px] transition-colors",
          cutOff
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:border-amber-500 hover:bg-amber-500/20 dark:text-amber-300"
            : "border-border bg-bg-paper text-fg-muted hover:border-accent hover:text-fg",
        )}
      >
        <ArrowRight className="h-3 w-3" />
        Continue
      </button>
      {cutOff && (
        <span className="font-serif text-[11px] italic text-amber-700 dark:text-amber-400">
          response hit max-tokens
        </span>
      )}
    </div>
  );
}

export default function Chat({ assistantId, sessionId: initialSessionId }: Props) {
  const confirm = useConfirm();
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [allTools, setAllTools] = useState<ToolPublic[]>([]);
  // null = not loaded yet. Distinguishes "loading" from "loaded and
  // genuinely empty" so the sidebar can show a spinner instead of
  // lying with 'no chats yet' while the first fetch is still in flight.
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Ref mirror kept in sync with state so async work (e.g. auto-compact
  // inside handleSend) can read the FRESH message list after a compact
  // rewrites it, rather than the closure's stale value.
  const messagesRef = useRef<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [ctx, setCtx] = useState({ prompt: 0, completion: 0 });
  const [toolOverride, setToolOverride] = useState<string[] | null>(null);
  const [showTools, setShowTools] = useState(false);
  // Default to open on desktop, closed on mobile — the ~240px sidebar
  // would otherwise eat most of a phone's screen on mount.
  const [showSidebar, setShowSidebar] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 768;
  });
  const [isDragging, setIsDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamingRef = useRef(false);
  const localSessionRef = useRef<string | null>(null);
  // Mirrors the Composer's artifact toggle so regen reuses the same mode.
  const lastArtifactsEnabledRef = useRef(false);
  // Tool-approval state — gates risky tool calls per the server's
  // requireApproval list.
  const [pendingApproval, setPendingApproval] = useState<{
    token: string;
    toolName: string;
    arguments: Record<string, unknown>;
    index: number;
  } | null>(null);
  const [sessionApprovedTools, setSessionApprovedTools] = useState<Set<string>>(
    new Set(),
  );
  // External attachment handoff — set by e.g. the artifact screenshot
  // button. Composer consumes it on mount-ish (via effect) and clears it
  // back to null. Not lifting attachments state fully; this is a
  // one-shot signal.
  const [pendingComposerAttachment, setPendingComposerAttachment] =
    useState<MsgAttachment | null>(null);

  // Cross-session search state. Query is what's in the input; hits is
  // the server response. When query is non-empty, the sidebar shows
  // hits instead of the normal session list.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [searchScope, setSearchScope] = useState<"current" | "all">(
    "current",
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const approvalDeciderRef = useRef<
    | ((d: {
        decision: "approve" | "deny" | "cancel";
        /** "none" = this call only · "tool" = skip for this tool name
         *  for the rest of the browser session · "all" = skip for every
         *  tool for the rest of the browser session. */
        persist: "none" | "tool" | "all";
      }) => void)
    | null
  >(null);

  function decideApproval(
    decision: "approve" | "deny" | "cancel",
    persist: "none" | "tool" | "all",
  ) {
    const d = approvalDeciderRef.current;
    approvalDeciderRef.current = null;
    setPendingApproval(null);
    d?.({ decision, persist });
  }
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
    fetch("/api/tools")
      .then((r) => r.json())
      .then((d: { tools: ToolPublic[] }) => setAllTools(d.tools));
  }, [assistantId]);

  // Models list is provider-dependent: Ollama assistants get the
  // local Ollama catalog; llama.cpp assistants get their server's
  // /v1/models + /props. Without this split, the ContextPie couldn't
  // resolve ctxMax for llama.cpp assistants (the loaded model wasn't
  // in the Ollama list), so auto-compact + pie rendering silently
  // broke.
  useEffect(() => {
    if (!assistant) return;
    const isLlama = assistant.provider === "llama-cpp";
    const llamaUrl = (assistant.llamaUrl ?? "").trim();
    const url =
      isLlama && llamaUrl
        ? `/api/models?url=${encodeURIComponent(llamaUrl)}`
        : "/api/models";
    fetch(url)
      .then((r) => r.json())
      .then((d: { models: ModelInfo[] }) => setModels(d.models ?? []))
      .catch(() => setModels([]));
  }, [assistant]);

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
      .then(async (r) => {
        if (r.status === 404) {
          // URL points at a session that no longer exists (data wiped,
          // session deleted, or fresh-slate restructure). Drop the
          // session id so the user lands on a clean new-chat view
          // instead of a TypeError on undefined.session.
          window.history.replaceState(null, "", `/chat/${assistantId}`);
          setSessionId(null);
          setMessages([]);
          setCtx({ prompt: 0, completion: 0 });
          return null;
        }
        if (!r.ok) throw new Error(`session GET ${r.status}`);
        return (await r.json()) as { session: Session };
      })
      .then((d) => {
        if (!d) return;
        setMessages(d.session.messages ?? []);
        setCtx({
          prompt: d.session.promptTokens,
          completion: d.session.completionTokens,
        });
      })
      .catch((e) => console.error("[chat] load session failed:", e));
  }, [sessionId, assistantId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, streaming]);

  // Keep the ref mirror in sync with state. Any async work that needs
  // post-compact messages reads through messagesRef.current.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Debounced cross-session search. < 2 chars = no request, clear hits.
  // Scope + assistant change without waiting for debounce since those
  // imply the user already committed.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchHits(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q,
          assistant: assistantId,
          scope: searchScope,
        });
        const r = await fetch(`/api/search?${params}`, {
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { hits: SearchHit[] };
        setSearchHits(j.hits);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          console.error("[search]", e);
          setSearchHits([]);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 150);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [searchQuery, searchScope, assistantId]);

  // Cmd/Ctrl-K focuses the sidebar search. Works anywhere in Chat unless
  // the user is typing in a textarea/input/contentEditable — we let
  // shortcuts inside those bubble through to their own handlers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hot = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (!hot) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "textarea" || tag === "input") {
        // Let the composer textarea keep Cmd-K unless we explicitly want
        // it — override only when the focus is OUR search input. That
        // way the Esc/arrow affordances don't collide.
        if (t !== searchInputRef.current) return;
      }
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctxMax = currentModel?.contextLength ?? null;
  // ctxMax used in auto-compact threshold + passed to ContextPie.
  // The pie component owns its own percent + colour-severity math.

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

  async function handleSend(
    text: string,
    attachments: MsgAttachment[],
    artifactsEnabled: boolean,
    templateId: string | null = null,
  ) {
    if (streaming) return;
    if (!assistant) return;
    lastArtifactsEnabledRef.current = artifactsEnabled;

    // Auto-compact gate. If the most recent prompt-token count is close
    // to the model's context window, summarise older messages BEFORE
    // sending. 70% trigger leaves ~30% headroom for the new user
    // message + the assistant's response; without this, a single large
    // send can push us past the window and Ollama either truncates
    // silently or rejects. compact() bails early on <6 messages so new
    // sessions are unaffected.
    const AUTO_COMPACT_AT = 0.7;
    if (
      ctxMax &&
      ctx.prompt / ctxMax >= AUTO_COMPACT_AT &&
      messagesRef.current.length >= 6
    ) {
      await compact();
    }

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      attachments: attachments.length ? attachments : undefined,
      createdAt: Date.now(),
    };
    // messagesRef (not `messages` closure) so a just-run auto-compact's
    // new list is used, not the stale pre-compact snapshot.
    const nextMessages = [...messagesRef.current, userMsg];
    setMessages(nextMessages);
    setStreaming(true);
    streamingRef.current = true;

    const sid = await ensureSession(text || "(image)");

    const assembled: ChatMessage[] = [...nextMessages];
    let curIndex = -1;
    // High-volume backends (pi-ai over Ollama /v1) emit character-level
    // deltas — a single streamed artifact can fire thousands of patchCur
    // calls, plus parallel timeline updates, plus explicit setMessages
    // calls from tool_call / tool_result handlers. All of them must go
    // through ONE throttle or React hits "Maximum update depth exceeded"
    // during heavy streams (big template JSON, parallel tools, etc).
    //
    // Leading+trailing throttle at ~25fps: fire immediately the first
    // time, then at most once per 40ms window. `flush()` is the single
    // source of truth — no setMessages elsewhere.
    let lastFlush = 0;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_WINDOW_MS = 40;
    const flushNow = () => {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      lastFlush = Date.now();
      setMessages([...assembled]);
    };
    const scheduleFlush = () => {
      if (pendingTimer !== null) return;
      const sinceLast = Date.now() - lastFlush;
      if (sinceLast >= FLUSH_WINDOW_MS) {
        flushNow();
        return;
      }
      pendingTimer = setTimeout(flushNow, FLUSH_WINDOW_MS - sinceLast);
    };
    const patchCur = (patch: Partial<ChatMessage>) => {
      if (curIndex < 0) return;
      assembled[curIndex] = { ...assembled[curIndex], ...patch };
      scheduleFlush();
    };

    // Timeline reducer — derives a phase trail from the SSE event stream
    // and stores it on the relevant assistant message. Tool phases are
    // tracked by their callId so parallel tools can close out of order.
    const toolOwner = new Map<string, number>();
    const now = () => Date.now();
    const updateTimelineAt = (
      idx: number,
      fn: (tl: TTimeline) => TTimeline,
    ) => {
      if (idx < 0 || idx >= assembled.length) return;
      const cur = assembled[idx];
      if (cur.role !== "assistant") return;
      const tl = cur.timeline ?? { startedAt: Date.now(), phases: [] };
      assembled[idx] = { ...cur, timeline: fn(tl) };
      scheduleFlush();
    };
    const ensureNonToolPhase = (kind: "thinking" | "writing") => {
      updateTimelineAt(curIndex, (tl) => {
        const phases = [...tl.phases];
        const last = phases[phases.length - 1];
        if (last && last.kind === kind && !last.endedAt) return tl;
        if (last && !last.endedAt && last.kind !== "tool") {
          phases[phases.length - 1] = { ...last, endedAt: now() };
        }
        phases.push({ kind, startedAt: now() });
        return { ...tl, phases };
      });
    };
    const openToolPhase = (name: string, callId: string) => {
      toolOwner.set(callId, curIndex);
      updateTimelineAt(curIndex, (tl) => {
        const phases = [...tl.phases];
        const last = phases[phases.length - 1];
        if (last && !last.endedAt && last.kind !== "tool") {
          phases[phases.length - 1] = { ...last, endedAt: now() };
        }
        phases.push({ kind: "tool", name, callId, startedAt: now() });
        return { ...tl, phases };
      });
    };
    const closeToolPhase = (callId: string, ok: boolean) => {
      const idx = toolOwner.get(callId);
      if (idx === undefined) return;
      toolOwner.delete(callId);
      updateTimelineAt(idx, (tl) => {
        const phases = tl.phases.map((p) =>
          p.kind === "tool" && p.callId === callId && !p.endedAt
            ? { ...p, endedAt: now(), ok }
            : p,
        );
        return { ...tl, phases };
      });
    };
    const closeTimelineAt = (idx: number) => {
      updateTimelineAt(idx, (tl) => ({
        ...tl,
        endedAt: now(),
        phases: tl.phases.map((p) =>
          p.endedAt === undefined ? { ...p, endedAt: now() } : p,
        ),
      }));
    };

    const startNewAssistant = () => {
      // Close the outgoing turn's timeline so its open phases get a final
      // timestamp. Without this, paused/interrupted turns would render
      // with perpetually-open phases on reload.
      if (
        curIndex >= 0 &&
        curIndex < assembled.length &&
        assembled[curIndex]?.role === "assistant"
      ) {
        closeTimelineAt(curIndex);
      }
      const a: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        thinking: "",
        createdAt: Date.now(),
        timeline: { startedAt: Date.now(), phases: [] },
      };
      assembled.push(a);
      curIndex = assembled.length - 1;
      scheduleFlush();
    };
    startNewAssistant();

    // Per-turn template augmentation: append the chosen template's
    // system prompt to the assistant's base prompt AND inline an
    // instruction on the last user message. The inline instruction is
    // the important part — without it, a template's system prompt gets
    // shadowed by any previous turn's assistant output in the same
    // session (models follow precedent). Storing the instruction only
    // on the wire keeps the persisted transcript clean.
    const tmpl = templateId ? TEMPLATES_BY_ID[templateId] : null;
    const systemWithTemplate = tmpl
      ? `${assistant.systemPrompt}\n\n---\n\n${tmpl.systemPrompt}`
      : assistant.systemPrompt;

    const wireMessages = nextMessages.map((m, i) => {
      const base = {
        role: m.role,
        content: m.content,
        thinking: m.thinking,
        toolCalls: m.toolCalls,
        toolName: m.toolName,
        attachments: m.attachments,
      };
      if (tmpl && i === nextMessages.length - 1 && m.role === "user") {
        return {
          ...base,
          content: `${m.content}\n\n[Respond using the ${tmpl.name} template: emit a \`\`\`template:${tmpl.id}\`\`\` fenced block with matching JSON. A 1–2 sentence lead above the fence is fine; no long intro.]`,
        };
      }
      return base;
    });

    const initialPayload = {
      model: activeModel,
      system: systemWithTemplate,
      messages: wireMessages,
      think: assistant.thinkMode === "off" ? false : assistant.thinkMode,
      enabledTools,
      artifactsEnabled,
      autoApproveTools: [...sessionApprovedTools],
      // If the assistant carries a num_ctx override, the server will
      // swap to a derived Ollama model automatically.
      contextLength: assistant.contextLength,
      // Session scope — required. The server refuses chat requests
      // without it (tools writing into the session's uploads/artifacts
      // dirs need an authoritative scope).
      assistantId: assistant.id,
      sessionId: sid,
      // Backend selector. When provider is "llama-cpp", llamaUrl
      // tells the server which local OpenAI-compat endpoint to hit.
      provider: assistant.provider ?? "ollama",
      llamaUrl: assistant.llamaUrl,
    };

    const ac = new AbortController();
    abortRef.current = ac;

    let lastTokens = { prompt: 0, completion: 0 };

    // Consumes one SSE stream. Returns a pause event if the loop paused
    // awaiting approval, or null when the stream ends normally.
    async function consumeStream(
      res: Response,
    ): Promise<{
      token: string;
      toolName: string;
      arguments: Record<string, unknown>;
      index: number;
    } | null> {
      if (!res.body) throw new Error("no body");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let pause: {
        token: string;
        toolName: string;
        arguments: Record<string, unknown>;
        index: number;
      } | null = null;

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
            ensureNonToolPhase("writing");
            const cur = assembled[curIndex];
            patchCur({ content: cur.content + String(obj.delta ?? "") });
          } else if (t === "thinking") {
            ensureNonToolPhase("thinking");
            const cur = assembled[curIndex];
            patchCur({
              thinking: (cur.thinking ?? "") + String(obj.delta ?? ""),
            });
          } else if (t === "done_turn") {
            const incoming = {
              prompt: Number(obj.promptTokens ?? 0),
              completion: Number(obj.completionTokens ?? 0),
            };
            // Monotonic guard within a streaming turn. Pi-agent-core
            // emits message_end per LLM round in a multi-tool turn;
            // each round's prompt should be ≥ the previous one
            // (conversation only grows). If we see a smaller value,
            // it's almost certainly a usage-reporting glitch from
            // the backend (e.g. KV-cache eviction, truncation, or a
            // round that skipped the usage field). Keep the high
            // water mark so the pie doesn't lie.
            if (incoming.prompt >= lastTokens.prompt) {
              lastTokens = incoming;
            } else {
              console.warn(
                "[ctx-guard] non-monotonic done_turn ignored: prompt %d → %d (kept %d)",
                lastTokens.prompt,
                incoming.prompt,
                lastTokens.prompt,
              );
              // Still update completion — that's per-round, not
              // cumulative, so a drop there is normal.
              lastTokens = {
                prompt: lastTokens.prompt,
                completion: incoming.completion,
              };
            }
            setCtx(lastTokens);
            // Stash this turn's output tokens on the assistant message
            // so the Turn timeline can render tokens/sec after the
            // stream ends.
            patchCur({ completionTokens: lastTokens.completion });
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
              ...(typeof obj.stopReason === "string"
                ? { stopReason: obj.stopReason as ChatMessage["stopReason"] }
                : {}),
            });
          } else if (t === "tool_call") {
            // Use the server's toolCallId as the React id so tool_result
            // can find THIS card — parallel execution fires multiple
            // tool_call events back-to-back, and a position-based match
            // overwrites the same card while the others spin forever.
            const callId = String(obj.id ?? uid());
            const toolName = String(obj.name ?? "");
            openToolPhase(toolName, callId);
            assembled.push({
              id: callId,
              role: "tool",
              content: "(running…)",
              toolName,
              toolArgs:
                obj.arguments &&
                typeof obj.arguments === "object"
                  ? (obj.arguments as Record<string, unknown>)
                  : undefined,
              createdAt: Date.now(),
            });
            scheduleFlush();
          } else if (t === "tool_result") {
            const callId = obj.id ? String(obj.id) : null;
            const ok = Boolean(obj.ok);
            if (callId) closeToolPhase(callId, ok);
            for (let i = assembled.length - 1; i >= 0; i--) {
              const m = assembled[i];
              const match = callId
                ? m.role === "tool" && m.id === callId
                : m.role === "tool";
              if (match) {
                assembled[i] = {
                  ...assembled[i],
                  content: String(obj.summary ?? ""),
                };
                break;
              }
            }
            scheduleFlush();
            // A tool_result marks a transition point; the next LLM turn
            // may produce content. But with parallel execution we see
            // several tool_results in a row — only the first one needs
            // to open a fresh assistant placeholder. Reuse an existing
            // trailing empty one on subsequent results.
            const tail = assembled[assembled.length - 1];
            const tailIsEmptyAssistant =
              tail?.role === "assistant" &&
              !tail.content &&
              !tail.thinking &&
              (!tail.toolCalls || tail.toolCalls.length === 0);
            if (tailIsEmptyAssistant) {
              const newIdx = assembled.length - 1;
              if (
                curIndex >= 0 &&
                curIndex !== newIdx &&
                assembled[curIndex]?.role === "assistant"
              ) {
                closeTimelineAt(curIndex);
              }
              curIndex = newIdx;
            } else {
              startNewAssistant();
            }
          } else if (t === "tool_approval_required") {
            pause = {
              token: String(obj.token ?? ""),
              toolName: String(obj.toolName ?? ""),
              arguments:
                (obj.arguments as Record<string, unknown>) ?? {},
              index: Number(obj.index ?? 0),
            };
            // Stream will close next; let the reader drain.
          } else if (t === "error") {
            const cur = assembled[curIndex];
            patchCur({
              content:
                cur.content + `\n\n**error:** ${String(obj.message ?? "")}`,
            });
          }
        }
      }
      return pause;
    }

    try {
      let nextFetch: { url: string; body: unknown } = {
        url: "/api/chat",
        body: initialPayload,
      };

      // Accumulates approvals ACROSS iterations of the approval loop
      // below. We can't re-read sessionApprovedTools each iteration
      // because handleSend captured it as a closure value on entry;
      // setSessionApprovedTools updates React state but not this
      // closure. Without cumulativeApproved, a turn with several
      // parallel tool gates would send only the LATEST tool in each
      // resume's autoApproveTools list — dropping previously-approved
      // tools and re-prompting the user for the same tool later in the
      // same run.
      let cumulativeApproved = new Set(sessionApprovedTools);

      // Outer loop drives fresh + resumed streams. Exits when a stream
      // ends without a pause event, or when the user cancels the pause.
      while (true) {
        const res = await fetch(nextFetch.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextFetch.body),
          signal: ac.signal,
        });
        const pause = await consumeStream(res);
        if (!pause) break;

        // Suspend until the user picks Approve / Approve for session /
        // Approve all / Deny / Cancel, or the abort controller fires.
        setPendingApproval(pause);
        const decision = await new Promise<{
          decision: "approve" | "deny" | "cancel";
          persist: "none" | "tool" | "all";
        }>((resolve) => {
          approvalDeciderRef.current = resolve;
        });
        approvalDeciderRef.current = null;
        setPendingApproval(null);

        if (decision.decision === "cancel") {
          break;
        }

        // Update the accumulating allowlist BEFORE the resume POST so
        // subsequent gated calls in this run skip approval. React state
        // also mirrors it for the NEXT user-initiated turn.
        if (decision.persist === "tool") {
          cumulativeApproved = new Set([
            ...cumulativeApproved,
            pause.toolName,
          ]);
          setSessionApprovedTools(cumulativeApproved);
        } else if (decision.persist === "all") {
          cumulativeApproved = new Set(allTools.map((t) => t.name));
          setSessionApprovedTools(cumulativeApproved);
        }
        nextFetch = {
          url: "/api/chat/resume",
          body: {
            token: pause.token,
            decision: decision.decision,
            autoApproveTools: [...cumulativeApproved],
          },
        };
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
      // Close the final turn's timeline so open phases get stamped.
      // Skip if the trim above popped the tail we were writing into.
      if (
        curIndex >= 0 &&
        curIndex < assembled.length &&
        assembled[curIndex]?.role === "assistant"
      ) {
        closeTimelineAt(curIndex);
      }
      flushNow();
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
    // If we're paused waiting for approval, resolve that first as a cancel
    // so handleSend's await unblocks and exits the loop cleanly.
    const decider = approvalDeciderRef.current;
    if (decider) {
      approvalDeciderRef.current = null;
      setPendingApproval(null);
      decider({ decision: "cancel", persist: "none" });
    }
    abortRef.current?.abort();
  }, []);

  // Dedup guard: a streaming assistant message can re-render many times
  // while content accumulates. ArtifactBlock fires onAutoFix per mount
  // with the same error — without this, we'd queue multiple fix turns
  // for the same broken artifact.
  const autoFixFiredRef = useRef<Set<string>>(new Set());
  const handleArtifactAutoFix = useCallback(
    (error: string) => {
      if (streamingRef.current) return;
      if (autoFixFiredRef.current.has(error)) return;
      autoFixFiredRef.current.add(error);
      // Keep the artifact toggle on so the fix turn regenerates a
      // fence instead of describing the fix in prose.
      lastArtifactsEnabledRef.current = true;
      const prompt = `The react-artifact you emitted didn't compile:\n\n${error}\n\nPlease re-emit a corrected \`\`\`react-artifact\`\`\` fence. Keep the same behaviour and title; fix only the syntax.`;
      handleSend(prompt, [], true);
    },
    // handleSend is intentionally not in deps — it's recreated every
    // render and pulling in its dep chain would make this callback
    // churn every frame, defeating the memo guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
    // replay with the original content + attachments, preserving artifact mode
    await handleSend(
      last.content,
      last.attachments ?? [],
      lastArtifactsEnabledRef.current,
    );
  }

  /** Nudge the model to keep going. Used when the user thinks the
   *  reply was cut short (max_tokens) or the model just stopped
   *  abruptly. Sends a fresh user turn with a short directive that
   *  most models recognise. We intentionally don't truncate the
   *  prior assistant message — the model continues *from* it,
   *  appending in a new message. */
  async function continueLast() {
    if (streaming) return;
    await handleSend(
      "Continue from where you stopped — pick up exactly where the last response ended, no recap.",
      [],
      lastArtifactsEnabledRef.current,
    );
  }

  async function newSession() {
    setSessionId(null);
    setMessages([]);
    setCtx({ prompt: 0, completion: 0 });
    window.history.replaceState(null, "", `/chat/${assistantId}`);
  }

  async function deleteSession(id: string) {
    if (
      !(await confirm({
        title: "Delete chat",
        message:
          "Delete this chat along with its uploads and artifacts? This can't be undone.",
        tone: "danger",
      }))
    )
      return;
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (sessionId === id) newSession();
    loadSessions();
  }

  async function togglePinSession(id: string, nextPinned: boolean) {
    // Optimistic — flip locally, then PATCH. Refresh list on response.
    setSessions((prev) =>
      prev
        ? prev.map((s) =>
            s.id === id ? { ...s, pinned: nextPinned } : s,
          )
        : prev,
    );
    try {
      await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
    } catch {
      // revert on failure
      setSessions((prev) =>
        prev
          ? prev.map((s) =>
              s.id === id ? { ...s, pinned: !nextPinned } : s,
            )
          : prev,
      );
    }
  }

  async function compact() {
    if (!assistant || !sessionId || messages.length < 6 || streaming) return;

    const keep = messages.slice(-4);
    const older = messages.slice(0, messages.length - 4);
    // Budget-aware compaction — everything scales from ctxMax so we
    // never produce a summary that itself doesn't fit. Three knobs:
    //   - summaryBudget: output tokens the summariser may emit.
    //     Min(20% of ctxMax, 8k). 8k matches llama-server's default
    //     `-n 8192` ceiling; Ollama is usually uncapped so 8k is the
    //     practical limit on both paths.
    //   - safetyMargin: system prompt + memory injection + a buffer
    //     for the NEXT user message. 5% of ctxMax, floored at 2k.
    //   - inputBudget: ctxMax - keep - summary - safety.
    //     This is the total older-history tokens we feed to the
    //     summariser. Middle-out truncated if exceeded.
    // Fallback when ctxMax is unknown: conservative 32k defaults.
    const fallbackCtx = 32_000;
    const ctxForCalc = ctxMax ?? fallbackCtx;
    const estimateTokens = (s: string) => Math.ceil(s.length / 4);
    const keepTokens = keep.reduce(
      (sum, m) => sum + estimateTokens(m.content ?? "") + estimateTokens(m.thinking ?? ""),
      0,
    );
    const summaryBudget = Math.min(8000, Math.floor(ctxForCalc * 0.2));
    const safetyMargin = Math.max(2000, Math.floor(ctxForCalc * 0.05));
    const inputBudget = Math.max(
      2000,
      ctxForCalc - keepTokens - summaryBudget - safetyMargin,
    );

    // Serialise older messages (drop tool-role — they're noisy tool
    // outputs already referenced by the assistant turns that called
    // them). Each gets a `[role] content` wrapper the model can
    // parse.
    const blocks = older
      .filter((m) => m.role !== "tool")
      .map((m) => `[${m.role}] ${m.content}`);

    // Middle-out truncation: if the serialised blob exceeds
    // inputBudget, keep a head slice and a tail slice, dropping the
    // middle. Head preserves origin context (project setup, early
    // decisions); tail preserves what's most recent before `keep`.
    // Marker replaces the gap so the summariser knows content was
    // elided. Head/tail split 50/50 of the budget.
    const joined = blocks.join("\n\n");
    let summaryText: string;
    let omittedCount = 0;
    if (estimateTokens(joined) <= inputBudget) {
      summaryText = joined;
    } else {
      const halfCharBudget = Math.floor((inputBudget * 4) / 2);
      let headChars = 0;
      const headBlocks: string[] = [];
      for (const b of blocks) {
        if (headChars + b.length > halfCharBudget) break;
        headBlocks.push(b);
        headChars += b.length + 2; // +2 for "\n\n" separator
      }
      let tailChars = 0;
      const tailBlocks: string[] = [];
      for (let i = blocks.length - 1; i >= headBlocks.length; i--) {
        if (tailChars + blocks[i].length > halfCharBudget) break;
        tailBlocks.unshift(blocks[i]);
        tailChars += blocks[i].length + 2;
      }
      omittedCount =
        blocks.length - headBlocks.length - tailBlocks.length;
      summaryText = [
        ...headBlocks,
        `[system-note] … ${omittedCount} middle messages elided to fit summariser budget …`,
        ...tailBlocks,
      ].join("\n\n");
    }

    const placeholderId = uid();
    const makePlaceholder = (streamedText: string): ChatMessage => ({
      id: placeholderId,
      role: "system",
      content: streamedText
        ? `⏳ Summarising ${older.length} earlier messages${omittedCount ? ` (${omittedCount} in the middle elided)` : ""}…\n\n${streamedText}`
        : `⏳ Summarising ${older.length} earlier messages${omittedCount ? ` (${omittedCount} in the middle elided)` : ""}…`,
      createdAt: Date.now(),
    });

    // Lock UI + render placeholder IMMEDIATELY in a single React batch so
    // the user sees it the instant they click, not after a network hop.
    setStreaming(true);
    streamingRef.current = true;
    setMessages([makePlaceholder(""), ...keep]);

    let text = "";
    try {
      // Prefer a small-and-fast local summariser when available, but
      // llama.cpp assistants only have the one model loaded — use
      // that. Ollama assistants get the 9b_128k fast-path if pulled.
      const isLlama = assistant.provider === "llama-cpp";
      const summariserModel = isLlama
        ? activeModel
        : models.find((m) => m.name.includes("9b_128k"))?.name ?? activeModel;
      // Target length guidance in the system prompt — models follow
      // these loosely but a clear number anchors them. Scaled to
      // summaryBudget, expressed in "words" (~0.75 tokens/word) since
      // that's how writers think.
      const targetWords = Math.floor(summaryBudget * 0.75);
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: summariserModel,
          system:
            `Compress the chat history into a rich, faithful summary. Target length: around ${targetWords} words (±30%). Preserve: names, IDs, file paths, commit hashes, URLs, exact error messages, and specific numbers verbatim. Organise by topic with short ## sub-headings. Under each, use terse bullets capturing: what happened, decisions made, open questions, unresolved errors, facts about the user or project. Don't compress so tightly that specifics are lost — the summary is replacing the actual transcript and will be the agent's only memory of pre-compact turns. If the input contains a '[system-note] … elided …' marker, acknowledge the gap in a bullet.`,
          messages: [{ role: "user", content: summaryText }],
          think: false,
          // Even the summariser needs scope so server-side validation
          // doesn't reject it. compact() only runs on an established
          // session (ctx hit 70%, ≥6 messages), so sessionId is
          // guaranteed non-null here.
          assistantId: assistant.id,
          sessionId: sessionId as string,
          provider: assistant.provider ?? "ollama",
          llamaUrl: assistant.llamaUrl,
        }),
      });
      if (!r.ok || !r.body) {
        throw new Error(`summariser returned HTTP ${r.status}`);
      }

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
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
            if (obj.type === "content") {
              text += String(obj.delta ?? "");
              const partial = makePlaceholder(text);
              setMessages((prev) =>
                prev.map((m) => (m.id === placeholderId ? partial : m)),
              );
            } else if (obj.type === "error") {
              throw new Error(
                `summariser error: ${String(obj.message ?? "unknown")}`,
              );
            }
          } catch (inner) {
            // Only re-throw if it's one we created — JSON.parse errors
            // should be swallowed so a single malformed chunk doesn't kill
            // the stream.
            if (inner instanceof Error && inner.message.startsWith("summariser error")) {
              throw inner;
            }
          }
        }
      }

      const clean = text.trim();
      if (!clean) throw new Error("summariser returned empty content");

      const compactMsg: ChatMessage = {
        id: placeholderId,
        role: "system",
        content: `Earlier conversation summarised — ${older.length} turns → 1 note\n\n${clean}`,
        createdAt: Date.now(),
      };
      const next = [compactMsg, ...keep];
      setMessages(next);
      // Recompute ctx from the post-compact conversation. The
      // summariser's own done_turn left `ctx` reflecting ITS api
      // call (~5k prompt + ~3k summary), not the new conversation
      // state. Without this override the pie shows a misleading
      // "drop" after compact — and we'd persist that wrong number
      // to session.meta. Estimate via chars/4; the next real user
      // turn's done_turn will replace this with the model's
      // authoritative count.
      const estimateTokens = (s: string) => Math.ceil(s.length / 4);
      const newCtx = {
        prompt: next.reduce(
          (sum, m) =>
            sum +
            estimateTokens(m.content ?? "") +
            estimateTokens(m.thinking ?? ""),
          0,
        ),
        completion: 0,
      };
      setCtx(newCtx);
      await persist(sessionId, next, newCtx);
    } catch (e) {
      // Revert — remove the placeholder, restore original messages — and
      // surface the failure inline as a system note (no browser alert).
      const err: ChatMessage = {
        id: uid(),
        role: "system",
        content: `⚠ Compact failed: ${(e as Error).message}. Chat history was restored.`,
        createdAt: Date.now(),
      };
      setMessages([...older, ...keep, err]);
    } finally {
      setStreaming(false);
      streamingRef.current = false;
    }
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
    <div className="flex h-[100dvh] bg-bg text-fg">
      {/* Mobile backdrop that dismisses the drawer. `md:hidden` so the
          desktop side-by-side layout never sees it. */}
      {showSidebar && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setShowSidebar(false)}
          aria-hidden
        />
      )}
      {/* sessions sidebar — drawer on mobile (<md), static column on ≥md */}
      {showSidebar && (
        <aside className="fixed inset-y-0 left-0 z-30 flex w-[85vw] max-w-[320px] flex-col border-r border-border bg-bg-elev shadow-xl md:static md:z-auto md:w-60 md:max-w-none md:shadow-none">
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
          <div className="mx-2 mt-2 flex items-center gap-1 rounded border border-border bg-bg px-2 py-1.5 focus-within:border-accent">
            <Search className="h-3 w-3 flex-shrink-0 text-fg-subtle" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              placeholder="Search chats…"
              className="flex-1 bg-transparent font-sans text-[12px] text-fg placeholder:text-fg-subtle/70 focus:outline-none"
            />
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery("")}
                className="tt text-fg-subtle hover:text-fg"
                data-tip="Clear"
                aria-label="Clear search"
              >
                <XIcon className="h-3 w-3" />
              </button>
            ) : (
              <span className="hidden font-mono text-[9px] text-fg-subtle sm:inline">
                ⌘K
              </span>
            )}
          </div>
          {searchQuery.trim().length >= 2 && (
            <div className="mx-2 mt-1 flex items-center gap-1 text-[10.5px]">
              <button
                onClick={() => setSearchScope("current")}
                className={cn(
                  "rounded px-1.5 py-[2px] font-mono uppercase tracking-wider",
                  searchScope === "current"
                    ? "bg-accent-soft text-accent"
                    : "text-fg-subtle hover:text-fg",
                )}
              >
                this assistant
              </button>
              <button
                onClick={() => setSearchScope("all")}
                className={cn(
                  "rounded px-1.5 py-[2px] font-mono uppercase tracking-wider",
                  searchScope === "all"
                    ? "bg-accent-soft text-accent"
                    : "text-fg-subtle hover:text-fg",
                )}
              >
                all
              </button>
              {searchLoading && (
                <Loader2 className="ml-auto h-3 w-3 animate-spin text-fg-subtle" />
              )}
            </div>
          )}
          <button
            onClick={newSession}
            className="mx-2 mt-2 flex items-center gap-2 rounded border border-dashed border-border px-3 py-2 font-sans text-[12px] text-fg-muted hover:border-accent hover:text-fg"
          >
            <Plus className="h-3.5 w-3.5" />
            New chat
          </button>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {searchHits !== null ? (
              searchHits.length === 0 ? (
                <div className="px-2 py-4 text-center font-serif text-[12px] italic text-fg-subtle">
                  {searchLoading ? "searching…" : "no matches"}
                </div>
              ) : (
                searchHits.map((h) => {
                  const crossAssistant = h.assistantId !== assistantId;
                  const goto = () => {
                    if (crossAssistant) {
                      // Different assistant → full navigation (fresh
                      // Chat component, loads assistant + session).
                      window.location.href = `/chat/${h.assistantId}/${h.sessionId}`;
                      return;
                    }
                    setSessionId(h.sessionId);
                    window.history.replaceState(
                      null,
                      "",
                      `/chat/${assistantId}/${h.sessionId}`,
                    );
                    setSearchQuery("");
                    if (window.innerWidth < 768) setShowSidebar(false);
                  };
                  const firstMatch = h.matches[0];
                  return (
                    <button
                      key={`${h.assistantId}/${h.sessionId}`}
                      onClick={goto}
                      className={cn(
                        "group mb-1 flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-bg-muted/70",
                        h.sessionId === sessionId && "bg-bg-muted",
                      )}
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="min-w-0 flex-1 truncate font-serif text-[13px] text-fg">
                          {h.title || "Untitled"}
                        </span>
                        <span className="flex-shrink-0 font-mono text-[9px] text-fg-subtle">
                          ×{h.matchCount}
                        </span>
                      </div>
                      {firstMatch && (
                        <div className="line-clamp-2 font-serif text-[11.5px] italic text-fg-muted">
                          {firstMatch.snippet.slice(0, firstMatch.matchStart)}
                          <mark className="bg-accent-soft px-[1px] text-accent not-italic">
                            {firstMatch.snippet.slice(
                              firstMatch.matchStart,
                              firstMatch.matchStart + firstMatch.matchLen,
                            )}
                          </mark>
                          {firstMatch.snippet.slice(
                            firstMatch.matchStart + firstMatch.matchLen,
                          )}
                        </div>
                      )}
                      {crossAssistant && (
                        <div className="font-mono text-[9.5px] uppercase tracking-wider text-fg-subtle">
                          ↗ other assistant
                        </div>
                      )}
                    </button>
                  );
                })
              )
            ) : (
              <>
                {sessions === null ? (
                  <div className="flex items-center justify-center gap-2 px-2 py-6 font-serif text-[12px] italic text-fg-subtle">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    loading chats…
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="px-2 py-4 text-center font-serif text-[12px] italic text-fg-subtle">
                    no chats yet
                  </div>
                ) : null}
                {(sessions ?? []).map((s) => (
              <div
                key={s.id}
                className={cn(
                  "group flex items-center gap-1 rounded px-2 py-1.5 font-serif text-[13px]",
                  s.id === sessionId
                    ? "bg-bg-muted text-fg"
                    : "text-fg-muted hover:bg-bg-muted/70 hover:text-fg",
                  s.pinned && "border-l-2 border-accent pl-1.5",
                )}
              >
                <button
                  onClick={() => {
                    setSessionId(s.id);
                    window.history.replaceState(
                      null, "", `/chat/${assistantId}/${s.id}`,
                    );
                    // Close the drawer after a pick on mobile so the
                    // chat becomes visible; harmless on desktop.
                    if (window.innerWidth < 768) setShowSidebar(false);
                  }}
                  className={cn(
                    "flex-1 truncate text-left",
                    s.pinned && "font-medium text-fg",
                  )}
                >
                  {s.title || "Untitled"}
                </button>
                {(s.promptTokens + s.completionTokens) > 0 && (
                  <span className="ml-1 flex-shrink-0 font-mono text-[9.5px] tabular-nums text-fg-subtle group-hover:hidden">
                    {fmtTokens(s.promptTokens + s.completionTokens)}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinSession(s.id, !s.pinned);
                  }}
                  className={cn(
                    "flex-shrink-0 transition-opacity",
                    s.pinned
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100",
                  )}
                  aria-label={s.pinned ? "Unpin" : "Pin"}
                  title={
                    s.pinned
                      ? "Pinned — protected from auto-cleanup"
                      : "Pin (protect from auto-cleanup)"
                  }
                >
                  <Pin
                    className={cn(
                      "h-3 w-3",
                      s.pinned
                        ? "fill-accent text-accent"
                        : "text-fg-subtle hover:text-accent",
                    )}
                  />
                </button>
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
              </>
            )}
          </div>
        </aside>
      )}

      {/* main column. `min-w-0` is the classic fix for flex-1 eating
          horizontal viewport: without it, wide descendants (code
          blocks, news carousels, long URLs) force this column past
          the screen and spawn a horizontal scrollbar on mobile. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-bg-elev px-3 py-2 md:flex-nowrap md:gap-x-3 md:px-4"
          style={{
            // Notched phones + mobile browsers where the URL bar
            // slides over the page top. env() is a viewport-aware
            // inset; 0 on desktop/non-notched browsers so layout
            // doesn't shift there.
            paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          }}
        >
          <button
            onClick={() => setShowSidebar((v) => !v)}
            className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
            aria-label="Toggle sidebar"
            data-tip="Sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <div
            className="tt max-w-[140px] truncate rounded-sm bg-bg-paper px-2 py-1 font-mono text-[11px] text-fg-muted md:max-w-none"
            data-tip="Model is set in the assistant editor"
          >
            {activeModel}
          </div>
          <CapabilityPills model={currentModel} />
          {ctxMax && (
            <ContextPie
              used={ctx.prompt}
              total={ctxMax}
              lastPrompt={ctx.prompt}
              lastCompletion={ctx.completion}
              onCompact={compact}
              canCompact={!!sessionId && messages.length >= 6 && !streaming}
              compactDisabledReason={
                !sessionId
                  ? "No session"
                  : messages.length < 6
                    ? "Needs 6+ messages"
                    : streaming
                      ? "Busy streaming"
                      : undefined
              }
              exportHref={
                sessionId ? `/api/sessions/${sessionId}/export` : undefined
              }
              canExport={!!sessionId}
            />
          )}
          <div className="flex items-center gap-1 md:ml-auto">
            <button
              onClick={() => setShowTools((v) => !v)}
              className={cn(
                "tt flex items-center gap-1 rounded border px-2 py-1 font-sans text-[11px]",
                showTools
                  ? "border-accent bg-accent/10 text-fg"
                  : "border-border text-fg-muted hover:text-fg",
              )}
              data-tip="Toggle tool panel"
              aria-label="Toggle tool panel"
            >
              <Wrench className="h-3 w-3" />
              <span className="hidden md:inline">
                Tools · {enabledTools.length}
              </span>
              <span className="md:hidden">{enabledTools.length}</span>
            </button>
            <StyleSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <div className="flex min-w-0 flex-1 overflow-hidden">
          <div
            ref={scrollRef}
            className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
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
                // Last assistant message — anchor for the Continue
                // button so it only appears at the bottom of the
                // most-recent assistant turn.
                const lastAssistantIdx = (() => {
                  for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i].role === "assistant") return i;
                  }
                  return -1;
                })();
                // Tracks whether we've already seen a user message so the
                // fleuron rule only appears BETWEEN exchanges, not above
                // the very first one.
                let sawUser = false;
                return messages.map((m, i) => {
                  const opensNewExchange = m.role === "user" && sawUser;
                  if (m.role === "user") sawUser = true;
                  return (
                  <div key={m.id}>
                    {opensNewExchange && (
                      <div className="turn-rule" aria-hidden="true">
                        ❧
                      </div>
                    )}
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
                      onContinue={
                        !streaming &&
                        i === lastAssistantIdx &&
                        m.role === "assistant"
                          ? continueLast
                          : undefined
                      }
                      onArtifactAutoFix={handleArtifactAutoFix}
                    />
                  </div>
                  );
                });
              })()}
              {pendingApproval && (
                <ToolApprovalCard
                  toolName={pendingApproval.toolName}
                  args={pendingApproval.arguments}
                  onApproveOnce={() => decideApproval("approve", "none")}
                  onApproveSession={() => decideApproval("approve", "tool")}
                  onApproveAllSession={() =>
                    decideApproval("approve", "all")
                  }
                  onDeny={() => decideApproval("deny", "none")}
                />
              )}
            </div>
          </div>

          {artifactOpenId ? (
            <ArtifactPanel
              onFixRequest={(prompt) => {
                // Force artifact mode on for the fix turn so the model
                // regenerates a react-artifact fence.
                lastArtifactsEnabledRef.current = true;
                handleSend(prompt, [], true);
              }}
              onAttachScreenshot={(a) => setPendingComposerAttachment(a)}
            />
          ) : showTools && (
            <>
              {/* Backdrop — mobile only — taps close the drawer. */}
              <div
                className="fixed inset-0 z-20 bg-black/40 md:hidden"
                onClick={() => setShowTools(false)}
                aria-hidden
              />
              <aside className="fixed inset-y-0 right-0 z-30 w-[85vw] max-w-[320px] overflow-y-auto border-l border-border bg-bg-elev p-3 shadow-xl md:static md:z-auto md:w-72 md:max-w-none md:shadow-none">
                <div className="mb-2 flex items-center justify-between">
                  <div className="byline">tools</div>
                  {/* Close control — visible below md because the
                      trigger in the top bar is covered by this drawer
                      when open. */}
                  <button
                    onClick={() => setShowTools(false)}
                    className="tt rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg md:hidden"
                    data-tip="Close"
                    aria-label="Close tools panel"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
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
            </>
          )}
        </div>

        <Composer
          assistantName={assistant.name}
          assistantId={assistant.id}
          resolveSessionId={() => ensureSession("New chat")}
          streaming={streaming}
          onSend={handleSend}
          onAbort={handleAbort}
          pendingAttachment={pendingComposerAttachment}
          onPendingAttachmentConsumed={() =>
            setPendingComposerAttachment(null)
          }
        />
      </div>
    </div>
  );
}

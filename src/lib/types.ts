export type ModelInfo = {
  name: string;
  size: number;
  family: string;
  params: string;
  quant: string;
  capabilities: string[];
  contextLength: number | null;
};

export type Assistant = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  model: string;
  systemPrompt: string;
  enabledTools: string[];
  thinkMode: "off" | "low" | "medium" | "high";
  createdAt: number;
  updatedAt: number;
};

export type MsgAttachment =
  | {
      type: "image";
      mimeType: string;
      /** Content-addressed filename served by /api/attachment/<filename>. */
      filename?: string;
      /** Inline base64 (legacy; still supported for backward-compat). */
      data?: string;
      /** Original filename as uploaded — used for display only. */
      originalName?: string;
    }
  | {
      type: "document";
      mimeType: string;
      /** Content-addressed filename of the raw file. */
      filename: string;
      /** Basename of the extracted-text sidecar (filename + .txt). */
      textFilename: string;
      /** Bytes of the source file, for UI display. */
      bytes?: number;
      /** Original filename as uploaded — used for display only. */
      originalName?: string;
    };

export type TurnPhase =
  | { kind: "thinking"; startedAt: number; endedAt?: number }
  | { kind: "writing"; startedAt: number; endedAt?: number }
  | {
      kind: "tool";
      name: string;
      callId: string;
      startedAt: number;
      endedAt?: number;
      ok?: boolean;
    };

/** Retrospective of what happened during a single assistant turn — thinking,
 *  writing, tool-call phases — derived from the SSE stream. Stored on the
 *  assistant ChatMessage so it renders after reloads. */
export type TurnTimeline = {
  startedAt: number;
  endedAt?: number;
  phases: TurnPhase[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  thinking?: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  toolName?: string;
  /** Arguments the tool was invoked with. Shown on the ToolCard so the
   *  user can see the URL fetched, query searched, command executed, etc.
   *  Only set on role:"tool" messages. */
  toolArgs?: Record<string, unknown>;
  /** Phase timeline for a single assistant turn. Only on assistant
   *  messages. Persists across reloads. */
  timeline?: TurnTimeline;
  /** Output tokens for this turn (from Ollama's `eval_count`). Combined
   *  with the turn timeline's non-tool phases this gives a meaningful
   *  tokens/sec metric. Only on assistant messages. */
  completionTokens?: number;
  attachments?: MsgAttachment[];
  createdAt: number;
};

export type Session = {
  id: string;
  assistantId: string;
  title: string;
  modelOverride: string | null;
  messages: ChatMessage[];
  promptTokens: number;
  completionTokens: number;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
};

export type ToolPublic = { name: string; group: string; description: string };

export type Artifact = {
  id: string;
  title: string;
  sessionId: string | null;
  assistantId: string | null;
  source: string; // JSX source
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
};

export const MEMORY_TYPES = [
  "fact",
  "preference",
  "episodic",
  "procedural",
  "event",
  "semantic",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export type MemoryEntry = {
  id: string;
  type: MemoryType;
  content: string;
  source: "user" | "model";
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
};


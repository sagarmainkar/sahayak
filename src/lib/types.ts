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

export type MsgAttachment = {
  type: "image";
  mimeType: string;
  /** Content-addressed filename served by /api/attachment/<filename>. Preferred. */
  filename?: string;
  /** Inline base64 (legacy; still supported for backward-compat). */
  data?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  thinking?: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  toolName?: string;
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
};

export type ToolPublic = { name: string; group: string; description: string };

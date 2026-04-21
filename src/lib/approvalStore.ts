/**
 * Server-side in-memory store for paused tool-calling loops awaiting user
 * approval. Key is a token returned to the client; value is the loop state
 * needed to resume.
 *
 * State lives in the Node process. Restarts drop pending approvals, which
 * is acceptable for a personal app. Entries older than TTL get GC'd so a
 * user who closed the tab doesn't leak state forever.
 */

type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

type OllamaMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
  images?: string[];
};

export type PausedLoop = {
  createdAt: number;
  messages: OllamaMsg[];
  pendingToolCalls: ToolCall[];
  pendingApprovalIndex: number;
  turn: number;
  // Request context needed to continue talking to Ollama.
  model: string;
  think: boolean | "low" | "medium" | "high";
  enabledTools: string[];
  autoApproveTools: string[];
  requireApproval: string[];
  maxToolTurns: number;
  artifactsEnabled: boolean;
};

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const store = new Map<string, PausedLoop>();

// Lazy GC: every time we touch the store, we sweep expired entries.
function sweep(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.createdAt > TTL_MS) store.delete(k);
  }
}

export function setPaused(token: string, state: PausedLoop): void {
  sweep();
  store.set(token, state);
}

export function takePaused(token: string): PausedLoop | null {
  sweep();
  const v = store.get(token);
  if (v) store.delete(token);
  return v ?? null;
}

import {
  createMemory,
  listMemories,
  searchMemory,
} from "@/lib/memory";
import {
  ACTIVE_MEMORY_TYPES,
  MEMORY_TYPES,
  type MemoryType,
} from "@/lib/types";
import { err, ok, type ToolSpec } from "./types";

const TYPE_ENUM = MEMORY_TYPES as readonly string[];
const ACTIVE_TYPE_ENUM = ACTIVE_MEMORY_TYPES as readonly string[];

function coerceType(t: unknown): MemoryType | null {
  return typeof t === "string" && TYPE_ENUM.includes(t)
    ? (t as MemoryType)
    : null;
}

const SOFT_CAP = 200;

export const remember: ToolSpec = {
  name: "remember",
  group: "memory",
  description:
    "Save a durable memory about the user. " +
    "Save ONLY: stable facts about the user or their environment they have asserted; lasting preferences they have stated; commands or how-tos the user wants you to reuse across sessions. " +
    "Do NOT save: third-party facts you can re-derive (stock symbols, news, public knowledge); session content (what we just discussed, current task state); anything the user did not explicitly assert about themselves or their setup. " +
    "If unsure, do not save — memory is for the user, not the world. " +
    "Memory is auto-recalled before every turn, so duplicates are silently absorbed; you do not need to search before saving.",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description:
          "fact = stable truth about the user/their setup; preference = how they like things; procedural = a command or how-to to reuse",
        enum: [...ACTIVE_TYPE_ENUM],
      },
      content: {
        type: "string",
        description:
          "The memory itself, one or two short sentences. Concrete and self-contained — should make sense read cold, out of context.",
      },
    },
    required: ["type", "content"],
  },
  async handler(args) {
    const type = coerceType(args.type);
    if (!type) {
      return err(
        "bad_type",
        `type must be one of ${ACTIVE_TYPE_ENUM.join(",")}`,
      );
    }
    const content = String(args.content ?? "").trim();
    if (!content) return err("empty_content", "content is required");
    const result = await createMemory({ type, content, source: "model" });
    const total = (await listMemories()).length;
    const out: Record<string, unknown> = {
      id: result.entry.id,
      type: result.entry.type,
      content: result.entry.content,
      status: result.status,
    };
    if (total > SOFT_CAP) out.pleaseReview = true;
    return ok(out);
  },
};

export const recallMemory: ToolSpec = {
  name: "recall_memory",
  group: "memory",
  description:
    "Semantic search across the user's memory pool. Use at the start of a reply when the user asks about past context, preferences, or anything you might have previously noted. Returns the top matching memories by cosine similarity.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to search for. Plain language is fine.",
      },
      limit: {
        type: "number",
        description: "How many results to return. Default 5, max 20.",
      },
      type: {
        type: "string",
        description: "Optional filter to a single memory type.",
        enum: [...TYPE_ENUM],
      },
    },
    required: ["query"],
  },
  async handler(args) {
    const query = String(args.query ?? "").trim();
    if (!query) return err("empty_query", "query is required");
    const limitRaw = Number(args.limit ?? 5);
    const limit = Math.max(1, Math.min(20, Number.isFinite(limitRaw) ? limitRaw : 5));
    const type = coerceType(args.type);
    const hits = await searchMemory(query, {
      limit,
      ...(type ? { type } : {}),
    });
    return ok({
      count: hits.length,
      results: hits.map((h) => ({
        id: h.entry.id,
        type: h.entry.type,
        content: h.entry.content,
        score: Math.round(h.score * 1000) / 1000,
      })),
    });
  },
};

export const listAllMemories: ToolSpec = {
  name: "list_memories",
  group: "memory",
  description:
    "Enumerate memories without semantic ranking. Use when the user asks 'what do you remember about me' or similar. Optional type filter.",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: "Optional filter to a single memory type.",
        enum: [...TYPE_ENUM],
      },
    },
    required: [],
  },
  async handler(args) {
    const type = coerceType(args.type);
    const all = await listMemories();
    const filtered = type ? all.filter((m) => m.type === type) : all;
    return ok({
      count: filtered.length,
      results: filtered.map((m) => ({
        id: m.id,
        type: m.type,
        content: m.content,
      })),
    });
  },
};

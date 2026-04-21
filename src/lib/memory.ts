import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { OLLAMA_URL } from "@/lib/ollama";
import {
  MEMORY_TYPES,
  type MemoryEntry,
  type MemoryType,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.jsonl");
const VEC_FILE = path.join(DATA_DIR, "memory.vec.jsonl");

const EMBED_MODEL = "nomic-embed-text";

// ---------- JSONL log record shapes ----------
type CreateRec = { op: "create"; entry: MemoryEntry };
type UpdateRec = {
  op: "update";
  id: string;
  content: string;
  type?: MemoryType;
  updatedAt: number;
};
type DeleteRec = { op: "delete"; id: string; at: number };
type LogRec = CreateRec | UpdateRec | DeleteRec;

type VecRec = { id: string; vector: number[] };

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function appendLog(rec: LogRec) {
  await ensureDirs();
  await fs.appendFile(MEMORY_FILE, JSON.stringify(rec) + "\n");
}

async function readLog(): Promise<LogRec[]> {
  if (!existsSync(MEMORY_FILE)) return [];
  const raw = await fs.readFile(MEMORY_FILE, "utf8");
  const out: LogRec[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LogRec);
    } catch {
      continue;
    }
  }
  return out;
}

/** Replay the log into the current live set of memories. */
export async function listMemories(): Promise<MemoryEntry[]> {
  const log = await readLog();
  const byId = new Map<string, MemoryEntry>();
  for (const rec of log) {
    if (rec.op === "create") {
      byId.set(rec.entry.id, rec.entry);
    } else if (rec.op === "update") {
      const cur = byId.get(rec.id);
      if (!cur) continue;
      byId.set(rec.id, {
        ...cur,
        content: rec.content,
        type: rec.type ?? cur.type,
        updatedAt: rec.updatedAt,
      });
    } else if (rec.op === "delete") {
      byId.delete(rec.id);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMemory(id: string): Promise<MemoryEntry | null> {
  const all = await listMemories();
  return all.find((m) => m.id === id) ?? null;
}

// ---------- vector sidecar ----------

async function readVectors(): Promise<Map<string, number[]>> {
  if (!existsSync(VEC_FILE)) return new Map();
  const raw = await fs.readFile(VEC_FILE, "utf8");
  const out = new Map<string, number[]>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as VecRec;
      out.set(r.id, r.vector);
    } catch {
      continue;
    }
  }
  return out;
}

async function appendVector(rec: VecRec) {
  await ensureDirs();
  await fs.appendFile(VEC_FILE, JSON.stringify(rec) + "\n");
}

/** Rewrite the vector sidecar from a fresh map. Used on rebuild and delete. */
async function writeVectors(map: Map<string, number[]>) {
  await ensureDirs();
  const lines: string[] = [];
  for (const [id, vector] of map) {
    lines.push(JSON.stringify({ id, vector } satisfies VecRec));
  }
  await fs.writeFile(VEC_FILE, lines.length ? lines.join("\n") + "\n" : "");
}

// ---------- embedding ----------

export async function embedText(text: string): Promise<number[] | null> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { embeddings?: number[][] };
    return j.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ---------- public CRUD ----------

function isMemoryType(t: unknown): t is MemoryType {
  return typeof t === "string" && (MEMORY_TYPES as readonly string[]).includes(t);
}

export async function createMemory(input: {
  type: MemoryType;
  content: string;
  source?: "user" | "model";
  sessionId?: string;
}): Promise<MemoryEntry> {
  const now = Date.now();
  const entry: MemoryEntry = {
    id: nanoid(10),
    type: input.type,
    content: input.content.trim(),
    source: input.source ?? "user",
    sessionId: input.sessionId,
    createdAt: now,
    updatedAt: now,
  };
  await appendLog({ op: "create", entry });
  const vec = await embedText(entry.content);
  if (vec) await appendVector({ id: entry.id, vector: vec });
  return entry;
}

export async function updateMemory(
  id: string,
  patch: { content?: string; type?: MemoryType },
): Promise<MemoryEntry | null> {
  const cur = await getMemory(id);
  if (!cur) return null;
  const content = patch.content?.trim() ?? cur.content;
  const type = patch.type ?? cur.type;
  const updatedAt = Date.now();
  await appendLog({ op: "update", id, content, type, updatedAt });
  if (content !== cur.content) {
    const vec = await embedText(content);
    if (vec) {
      // Rewrite sidecar with the updated vector for this id.
      const map = await readVectors();
      map.set(id, vec);
      await writeVectors(map);
    }
  }
  return { ...cur, content, type, updatedAt };
}

export async function deleteMemory(id: string): Promise<boolean> {
  const cur = await getMemory(id);
  if (!cur) return false;
  await appendLog({ op: "delete", id, at: Date.now() });
  const map = await readVectors();
  if (map.delete(id)) await writeVectors(map);
  return true;
}

export type SearchHit = {
  entry: MemoryEntry;
  score: number;
};

/**
 * Semantic search via cosine similarity against the vector sidecar.
 * Memories with no stored vector (e.g. captured while Ollama was offline)
 * are skipped silently — they can be indexed later via `rebuildVectors`.
 */
export async function searchMemory(
  query: string,
  opts?: { limit?: number; type?: MemoryType },
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const qVec = await embedText(q);
  if (!qVec) return [];
  const memories = await listMemories();
  const vectors = await readVectors();
  const limit = opts?.limit ?? 5;

  const hits: SearchHit[] = [];
  for (const m of memories) {
    if (opts?.type && m.type !== opts.type) continue;
    const v = vectors.get(m.id);
    if (!v) continue;
    const score = cosine(qVec, v);
    hits.push({ entry: m, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** Recompute embeddings for every live memory. Manual op. */
export async function rebuildVectors(): Promise<{
  indexed: number;
  skipped: number;
}> {
  const memories = await listMemories();
  const map = new Map<string, number[]>();
  let skipped = 0;
  for (const m of memories) {
    const v = await embedText(m.content);
    if (v) map.set(m.id, v);
    else skipped++;
  }
  await writeVectors(map);
  return { indexed: map.size, skipped };
}

export function isValidMemoryType(t: unknown): t is MemoryType {
  return isMemoryType(t);
}

/**
 * Build the always-injected memory block (facts + preferences) for
 * prepending to system prompts. Returns an empty string if there are
 * none. Newest entries first; capped to keep prompt bloat bounded.
 */
export async function buildAlwaysInjectedBlock(): Promise<string> {
  const all = await listMemories();
  const facts = all.filter((m) => m.type === "fact").slice(0, 50);
  const prefs = all.filter((m) => m.type === "preference").slice(0, 50);
  if (facts.length === 0 && prefs.length === 0) return "";

  const parts: string[] = ["Known about the user (always current):"];
  if (facts.length) {
    parts.push("", "Facts:");
    for (const m of facts) parts.push(`- ${m.content}`);
  }
  if (prefs.length) {
    parts.push("", "Preferences:");
    for (const m of prefs) parts.push(`- ${m.content}`);
  }
  return parts.join("\n");
}

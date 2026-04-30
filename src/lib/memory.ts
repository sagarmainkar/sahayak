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
import {
  CONFIG_DIR,
  MEMORY_FILE,
  MEMORY_META_FILE,
  MEMORY_VEC_FILE as VEC_FILE,
} from "@/lib/paths";

const EMBED_MODEL = "nomic-embed-text";

// ---------- JSONL log record shapes ----------
type CreateRec = { op: "create"; entry: MemoryEntry };
type UpdateRec = {
  op: "update";
  id: string;
  content: string;
  type?: MemoryType;
  updatedAt: number;
  vectorPending?: boolean;
};
type DeleteRec = { op: "delete"; id: string; at: number };
type LogRec = CreateRec | UpdateRec | DeleteRec;

type VecRec = { id: string; vector: number[]; lastRecalledAt?: number };

async function ensureDirs() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
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
      byId.set(rec.entry.id, { ...rec.entry });
    } else if (rec.op === "update") {
      const cur = byId.get(rec.id);
      if (!cur) continue;
      byId.set(rec.id, {
        ...cur,
        content: rec.content,
        type: rec.type ?? cur.type,
        updatedAt: rec.updatedAt,
        ...(rec.vectorPending !== undefined
          ? { vectorPending: rec.vectorPending }
          : {}),
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

type SidecarMap = Map<string, { vector: number[]; lastRecalledAt?: number }>;

async function readSidecar(): Promise<SidecarMap> {
  if (!existsSync(VEC_FILE)) return new Map();
  const raw = await fs.readFile(VEC_FILE, "utf8");
  const out: SidecarMap = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as VecRec;
      out.set(r.id, {
        vector: r.vector,
        lastRecalledAt: r.lastRecalledAt,
      });
    } catch {
      continue;
    }
  }
  return out;
}

async function readVectors(): Promise<Map<string, number[]>> {
  const sidecar = await readSidecar();
  const out = new Map<string, number[]>();
  for (const [id, v] of sidecar) out.set(id, v.vector);
  return out;
}

async function appendVector(rec: VecRec) {
  await ensureDirs();
  await fs.appendFile(VEC_FILE, JSON.stringify(rec) + "\n");
}

/** Rewrite the vector sidecar from a fresh map. Used on rebuild and delete. */
async function writeVectors(
  map: Map<string, number[]>,
  meta?: Map<string, { lastRecalledAt?: number }>,
) {
  await ensureDirs();
  const lines: string[] = [];
  for (const [id, vector] of map) {
    const m = meta?.get(id);
    const rec: VecRec = { id, vector };
    if (m?.lastRecalledAt !== undefined) rec.lastRecalledAt = m.lastRecalledAt;
    lines.push(JSON.stringify(rec));
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

export type CreateResult =
  | { status: "created"; entry: MemoryEntry }
  | { status: "already_known"; entry: MemoryEntry };

const DEDUP_THRESHOLD = 0.92;

export async function createMemory(input: {
  type: MemoryType;
  content: string;
  source?: "user" | "model";
  sessionId?: string;
}): Promise<CreateResult> {
  const now = Date.now();
  const content = input.content.trim();

  // Dedup: embed first, compare to existing vectors, return existing if too close.
  const candidateVec = await embedText(content);
  if (candidateVec) {
    const memories = await listMemories();
    const vectors = await readVectors();
    let bestId: string | null = null;
    let bestScore = 0;
    for (const m of memories) {
      const v = vectors.get(m.id);
      if (!v) continue;
      const s = cosine(candidateVec, v);
      if (s > bestScore) {
        bestScore = s;
        bestId = m.id;
      }
    }
    if (bestId && bestScore >= DEDUP_THRESHOLD) {
      const existing = memories.find((m) => m.id === bestId);
      if (existing) return { status: "already_known", entry: existing };
    }
  }

  const entry: MemoryEntry = {
    id: nanoid(10),
    type: input.type,
    content,
    source: input.source ?? "user",
    sessionId: input.sessionId,
    createdAt: now,
    updatedAt: now,
  };
  await appendLog({ op: "create", entry });
  if (candidateVec) {
    await appendVector({ id: entry.id, vector: candidateVec });
  } else {
    entry.vectorPending = true;
    await appendLog({
      op: "update",
      id: entry.id,
      content: entry.content,
      type: entry.type,
      updatedAt: now,
      vectorPending: true,
    });
  }
  return { status: "created", entry };
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

  let vectorPending: boolean | undefined;
  if (content !== cur.content) {
    const vec = await embedText(content);
    if (vec) {
      const sidecar = await readSidecar();
      const prev = sidecar.get(id);
      const vectors = new Map<string, number[]>();
      const meta = new Map<string, { lastRecalledAt?: number }>();
      for (const [sid, sv] of sidecar) {
        vectors.set(sid, sv.vector);
        if (sv.lastRecalledAt !== undefined)
          meta.set(sid, { lastRecalledAt: sv.lastRecalledAt });
      }
      vectors.set(id, vec);
      meta.set(id, { lastRecalledAt: prev?.lastRecalledAt });
      await writeVectors(vectors, meta);
      vectorPending = false;
    } else {
      vectorPending = true;
    }
  }

  await appendLog({
    op: "update",
    id,
    content,
    type,
    updatedAt,
    ...(vectorPending !== undefined ? { vectorPending } : {}),
  });
  return {
    ...cur,
    content,
    type,
    updatedAt,
    ...(vectorPending !== undefined ? { vectorPending } : {}),
  };
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
  lastRebuildAt: number;
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
  const lastRebuildAt = Date.now();
  await ensureDirs();
  await fs.writeFile(
    MEMORY_META_FILE,
    JSON.stringify({ lastRebuildAt }, null, 2),
  );
  return { indexed: map.size, skipped, lastRebuildAt };
}

export function isValidMemoryType(t: unknown): t is MemoryType {
  return isMemoryType(t);
}

/** Best-effort retry: pick up to `cap` entries with `vectorPending: true`,
 *  embed each, append to the sidecar, and emit an `update` log record
 *  clearing the flag. Called by the chat route per request. Failures stay
 *  pending and are picked up next time. */
export async function retryPendingVectors(
  cap = 5,
): Promise<{ retried: number; cleared: number }> {
  const memories = await listMemories();
  const pending = memories.filter((m) => m.vectorPending).slice(0, cap);
  let cleared = 0;
  for (const m of pending) {
    const vec = await embedText(m.content);
    if (!vec) continue;
    await appendVector({ id: m.id, vector: vec });
    await appendLog({
      op: "update",
      id: m.id,
      content: m.content,
      type: m.type,
      updatedAt: Date.now(),
      vectorPending: false,
    });
    cleared++;
  }
  return { retried: pending.length, cleared };
}

const BUMP_DEBOUNCE_MS = 60_000;

/** Update `lastRecalledAt` for a set of memory ids in the vector sidecar.
 *  Debounced: ids whose existing timestamp is younger than 60s are skipped
 *  to avoid hot-loops on repeated short queries. */
export async function bumpRecalledAt(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const sidecar = await readSidecar();
  const now = Date.now();
  let changed = false;
  for (const id of ids) {
    const cur = sidecar.get(id);
    if (!cur) continue;
    if (cur.lastRecalledAt && now - cur.lastRecalledAt < BUMP_DEBOUNCE_MS) {
      continue;
    }
    cur.lastRecalledAt = now;
    sidecar.set(id, cur);
    changed = true;
  }
  if (!changed) return;
  const vectors = new Map<string, number[]>();
  const meta = new Map<string, { lastRecalledAt?: number }>();
  for (const [id, v] of sidecar) {
    vectors.set(id, v.vector);
    if (v.lastRecalledAt !== undefined) {
      meta.set(id, { lastRecalledAt: v.lastRecalledAt });
    }
  }
  await writeVectors(vectors, meta);
}

export async function getMemoryHealth(): Promise<{
  total: number;
  indexed: number;
  pending: number;
  lastRebuildAt: number | null;
}> {
  const memories = await listMemories();
  const vectors = await readVectors();
  const indexed = memories.reduce(
    (n, m) => n + (vectors.has(m.id) ? 1 : 0),
    0,
  );
  const pending = memories.reduce(
    (n, m) => n + (m.vectorPending ? 1 : 0),
    0,
  );
  let lastRebuildAt: number | null = null;
  if (existsSync(MEMORY_META_FILE)) {
    try {
      const raw = await fs.readFile(MEMORY_META_FILE, "utf8");
      const parsed = JSON.parse(raw) as { lastRebuildAt?: number };
      if (typeof parsed.lastRebuildAt === "number")
        lastRebuildAt = parsed.lastRebuildAt;
    } catch {
      // fall through with null
    }
  }
  return {
    total: memories.length,
    indexed,
    pending,
    lastRebuildAt,
  };
}

/** Expose `lastRecalledAt` for the UI without dragging the sidecar map
 *  through API serialization. Returns a plain id → ts mapping. */
export async function getRecalledAtMap(): Promise<Record<string, number>> {
  const sidecar = await readSidecar();
  const out: Record<string, number> = {};
  for (const [id, v] of sidecar) {
    if (v.lastRecalledAt !== undefined) out[id] = v.lastRecalledAt;
  }
  return out;
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

const RECALL_DEFAULT_K = 3;
const RECALL_DEFAULT_THRESHOLD = 0.7;
const PINNED_TYPES: ReadonlySet<MemoryType> = new Set(["fact", "preference"]);

/** Score `userMessage` against the memory pool and return a formatted
 *  block ready to prepend to the system prompt. Empty string when no
 *  memory clears the threshold or embedding fails. */
export async function getRecallContext(
  userMessage: string,
  opts?: {
    k?: number;
    threshold?: number;
    /** When true (default), skip fact + preference — they're already in
     *  the always-injected block, no point doubling tokens. */
    excludePinnedTypes?: boolean;
  },
): Promise<string> {
  const q = userMessage.trim();
  if (!q) return "";
  const qVec = await embedText(q);
  if (!qVec) return "";

  const k = opts?.k ?? RECALL_DEFAULT_K;
  const threshold = opts?.threshold ?? RECALL_DEFAULT_THRESHOLD;
  const excludePinned = opts?.excludePinnedTypes ?? true;

  const memories = await listMemories();
  const vectors = await readVectors();
  const hits: { entry: MemoryEntry; score: number }[] = [];
  for (const m of memories) {
    if (excludePinned && PINNED_TYPES.has(m.type)) continue;
    const v = vectors.get(m.id);
    if (!v) continue;
    const score = cosine(qVec, v);
    if (score < threshold) continue;
    hits.push({ entry: m, score });
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, k);
  if (top.length === 0) return "";

  // Fire-and-forget: bump recall timestamps for the surfaced ids.
  bumpRecalledAt(top.map((h) => h.entry.id)).catch((err) => {
    console.warn("[memory] bumpRecalledAt failed:", err);
  });

  const lines: string[] = ["Possibly relevant from memory:"];
  for (const h of top) {
    const safe = h.entry.content
      .replace(/\s+/g, " ")
      .replace(/`/g, "'")
      .trim();
    lines.push(`- [${h.entry.type}] ${safe}`);
  }
  return lines.join("\n");
}

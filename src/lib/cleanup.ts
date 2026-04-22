import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { readSettings, CLEANUP_TTL_BOUNDS } from "@/lib/settings";

const DATA_DIR = path.join(process.cwd(), "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
const MARKER = path.join(DATA_DIR, ".last_cleanup");

// Resolved per-sweep from settings so the UI can change it live.
async function currentTtlDays(): Promise<number> {
  try {
    const s = await readSettings();
    return s.cleanup.ttlDays;
  } catch {
    return CLEANUP_TTL_BOUNDS.default;
  }
}
// How stale the marker can be before we re-sweep on the next listing.
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

export type SweepCandidate = {
  kind: "session" | "artifact";
  id: string;
  title: string;
  assistantId?: string;
  ageDays: number;
  sizeBytes: number;
  /** "age" — over TTL; "cascade" — its session is being swept. */
  reason: "age" | "cascade";
};

export type SweepReport = {
  candidates: SweepCandidate[];
  pinnedSkipped: number;
  ttlDays: number;
};

function ageDays(updatedAt: number): number {
  return Math.floor((Date.now() - updatedAt) / (24 * 60 * 60 * 1000));
}

async function readJsonlMeta(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const fh = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(buf, 0, 4096, 0);
      const nl = buf.subarray(0, bytesRead).indexOf(10);
      if (nl < 0) return null;
      const line = buf.subarray(0, nl).toString("utf8");
      const obj = JSON.parse(line);
      return obj.type === "meta" ? obj : null;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

async function fileSize(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).size;
  } catch {
    return 0;
  }
}

async function dirSize(p: string): Promise<number> {
  try {
    let total = 0;
    const entries = await fs.readdir(p, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) total += await dirSize(full);
      else total += await fileSize(full);
    }
    return total;
  } catch {
    return 0;
  }
}

async function listSessionCandidates(
  ttlMs: number,
): Promise<SweepCandidate[]> {
  const out: SweepCandidate[] = [];
  if (!existsSync(SESSIONS_DIR)) return out;
  for (const aid of await fs.readdir(SESSIONS_DIR)) {
    const dir = path.join(SESSIONS_DIR, aid);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    for (const f of files) {
      const fp = path.join(dir, f);
      const meta = await readJsonlMeta(fp);
      if (!meta) continue;
      const updatedAt = Number(meta.updatedAt ?? 0);
      const pinned = !!meta.pinned;
      const age = Date.now() - updatedAt;
      if (pinned) continue;
      if (age < ttlMs) continue;
      out.push({
        kind: "session",
        id: String(meta.id ?? f.replace(/\.jsonl$/, "")),
        title: String(meta.title ?? "Untitled"),
        assistantId: aid,
        ageDays: ageDays(updatedAt),
        sizeBytes: await fileSize(fp),
        reason: "age",
      });
    }
  }
  return out;
}

/**
 * For a set of session-ids about to be swept, find non-pinned artifacts
 * that reference those sessions — they get swept too, regardless of age.
 * Returns candidates deduped against any already-flagged artifact ids.
 */
async function listCascadeArtifacts(
  sessionIds: Set<string>,
  alreadyFlagged: Set<string>,
): Promise<SweepCandidate[]> {
  const out: SweepCandidate[] = [];
  if (!existsSync(ARTIFACTS_DIR) || sessionIds.size === 0) return out;
  const entries = await fs.readdir(ARTIFACTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (alreadyFlagged.has(id)) continue;
    const metaPath = path.join(ARTIFACTS_DIR, id, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
      if (meta.pinned) continue;
      if (!meta.sessionId || !sessionIds.has(String(meta.sessionId))) continue;
      const updatedAt = Number(meta.updatedAt ?? 0);
      out.push({
        kind: "artifact",
        id,
        title: String(meta.title ?? "Untitled"),
        ageDays: ageDays(updatedAt),
        sizeBytes: await dirSize(path.join(ARTIFACTS_DIR, id)),
        reason: "cascade",
      });
    } catch {
      continue;
    }
  }
  return out;
}

async function listArtifactCandidates(
  ttlMs: number,
): Promise<SweepCandidate[]> {
  const out: SweepCandidate[] = [];
  if (!existsSync(ARTIFACTS_DIR)) return out;
  const entries = await fs.readdir(ARTIFACTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const metaPath = path.join(ARTIFACTS_DIR, id, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
      const updatedAt = Number(meta.updatedAt ?? 0);
      const pinned = !!meta.pinned;
      const age = Date.now() - updatedAt;
      if (pinned) continue;
      if (age < ttlMs) continue;
      out.push({
        kind: "artifact",
        id,
        title: String(meta.title ?? "Untitled"),
        ageDays: ageDays(updatedAt),
        sizeBytes: await dirSize(path.join(ARTIFACTS_DIR, id)),
        reason: "age",
      });
    } catch {
      continue;
    }
  }
  return out;
}

async function countPinnedSessions(): Promise<number> {
  if (!existsSync(SESSIONS_DIR)) return 0;
  let n = 0;
  for (const aid of await fs.readdir(SESSIONS_DIR)) {
    const dir = path.join(SESSIONS_DIR, aid);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    for (const f of files) {
      const meta = await readJsonlMeta(path.join(dir, f));
      if (meta?.pinned) n++;
    }
  }
  return n;
}

async function countPinnedArtifacts(): Promise<number> {
  if (!existsSync(ARTIFACTS_DIR)) return 0;
  let n = 0;
  const entries = await fs.readdir(ARTIFACTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(ARTIFACTS_DIR, entry.name, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
      if (meta.pinned) n++;
    } catch {
      continue;
    }
  }
  return n;
}

export async function previewSweep(): Promise<SweepReport> {
  const ttlDays = await currentTtlDays();
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const [sess, arts, pinS, pinA] = await Promise.all([
    listSessionCandidates(ttlMs),
    listArtifactCandidates(ttlMs),
    countPinnedSessions(),
    countPinnedArtifacts(),
  ]);
  // Cascade — any non-pinned artifact owned by a session being swept
  // comes along, even if the artifact itself is fresh.
  const sessionIds = new Set(sess.map((s) => s.id));
  const flaggedArtifactIds = new Set(arts.map((a) => a.id));
  const cascade = await listCascadeArtifacts(sessionIds, flaggedArtifactIds);
  const all = [...sess, ...arts, ...cascade];
  return {
    candidates: all.sort((a, b) => {
      // Show oldest first; cascaded artifacts grouped under their session
      // conceptually, but simpler: sort by ageDays desc (cascade uses its
      // own updatedAt, which could be fresh — they'll appear near the top
      // of the "fresh" cluster but still in the list).
      return b.ageDays - a.ageDays;
    }),
    pinnedSkipped: pinS + pinA,
    ttlDays,
  };
}

export async function runSweep(): Promise<{
  deletedSessions: number;
  deletedArtifacts: number;
  freedBytes: number;
  pinnedSkipped: number;
  ttlDays: number;
}> {
  const report = await previewSweep();
  let deletedSessions = 0;
  let deletedArtifacts = 0;
  let freedBytes = 0;
  for (const c of report.candidates) {
    try {
      if (c.kind === "session" && c.assistantId) {
        const p = path.join(
          SESSIONS_DIR,
          c.assistantId,
          `${c.id}.jsonl`,
        );
        await fs.rm(p, { force: true });
        deletedSessions++;
      } else if (c.kind === "artifact") {
        const p = path.join(ARTIFACTS_DIR, c.id);
        if (existsSync(p)) await fs.rm(p, { recursive: true, force: true });
        deletedArtifacts++;
      }
      freedBytes += c.sizeBytes;
    } catch {
      // skip the individual failure; continue sweeping
    }
  }
  await touchMarker();
  return {
    deletedSessions,
    deletedArtifacts,
    freedBytes,
    pinnedSkipped: report.pinnedSkipped,
    ttlDays: report.ttlDays,
  };
}

async function readMarker(): Promise<number> {
  try {
    const raw = await fs.readFile(MARKER, "utf8");
    return Number(raw.trim()) || 0;
  } catch {
    return 0;
  }
}

async function touchMarker(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(MARKER, String(Date.now()));
  } catch {
    // Non-fatal — sweep just runs again next check.
  }
}

let sweepInFlight = false;

/**
 * Lazy background sweep. Call from hot API paths (e.g. session list).
 * No-ops if we swept recently OR another sweep is in flight.
 */
export async function maybeSweep(): Promise<void> {
  if (sweepInFlight) return;
  const last = await readMarker();
  if (Date.now() - last < SWEEP_EVERY_MS) return;
  // Mark in-flight *before* running so concurrent calls bail early.
  sweepInFlight = true;
  setImmediate(async () => {
    try {
      await runSweep();
    } catch {
      // swallow; will try again tomorrow
    } finally {
      sweepInFlight = false;
    }
  });
}

/** Current TTL resolved from settings (async). UI can also read it from
 *  `previewSweep().ttlDays`. */
export async function currentTtl(): Promise<number> {
  return currentTtlDays();
}

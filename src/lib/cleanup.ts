import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { readSettings, CLEANUP_TTL_BOUNDS } from "@/lib/settings";
import {
  DATA_DIR,
  LAST_CLEANUP_MARKER,
  assistantDir,
  sessionDir,
  sessionFile,
} from "@/lib/paths";

/**
 * Session-scoped cleanup. A session is the unit of deletion: every
 * upload, artifact, and data file it created lives under its own
 * directory, so the sweep just rips the whole directory in one
 * `rm -rf`. No cascade, no dedup, no artifact pinning — the session's
 * own `pinned` flag decides whether it survives.
 */

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
  kind: "session";
  id: string;
  title: string;
  assistantId: string;
  ageDays: number;
  sizeBytes: number;
  reason: "age";
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

async function dirSize(p: string): Promise<number> {
  try {
    let total = 0;
    const entries = await fs.readdir(p, { withFileTypes: true });
    for (const e of entries) {
      const full = `${p}/${e.name}`;
      if (e.isDirectory()) total += await dirSize(full);
      else {
        try {
          total += (await fs.stat(full)).size;
        } catch {}
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function previewSweep(): Promise<SweepReport> {
  const ttlDays = await currentTtlDays();
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const candidates: SweepCandidate[] = [];
  let pinnedSkipped = 0;
  if (!existsSync(DATA_DIR)) {
    return { candidates, pinnedSkipped: 0, ttlDays };
  }
  const now = Date.now();
  const aEntries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  for (const a of aEntries) {
    if (!a.isDirectory()) continue;
    const aid = a.name;
    const aDir = assistantDir(aid);
    let sEntries;
    try {
      sEntries = await fs.readdir(aDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const s of sEntries) {
      if (!s.isDirectory()) continue;
      const sid = s.name;
      const jsonl = sessionFile(aid, sid);
      if (!existsSync(jsonl)) continue;
      let mtimeMs: number;
      try {
        mtimeMs = (await fs.stat(jsonl)).mtimeMs;
      } catch {
        continue;
      }
      // Cheap mtime pre-filter: meta.json-analog inside session.jsonl
      // gets rewritten on every update, so mtime tracks updatedAt. Skip
      // parsing for fresh sessions entirely.
      if (now - mtimeMs < ttlMs) continue;
      const meta = await readJsonlMeta(jsonl);
      if (!meta) continue;
      const updatedAt = Number(meta.updatedAt ?? mtimeMs);
      if (now - updatedAt < ttlMs) continue;
      if (meta.pinned) {
        pinnedSkipped++;
        continue;
      }
      candidates.push({
        kind: "session",
        id: String(meta.id ?? sid),
        title: String(meta.title ?? "Untitled"),
        assistantId: aid,
        ageDays: ageDays(updatedAt),
        sizeBytes: await dirSize(sessionDir(aid, sid)),
        reason: "age",
      });
    }
  }
  candidates.sort((a, b) => b.ageDays - a.ageDays);
  return { candidates, pinnedSkipped, ttlDays };
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
  let freedBytes = 0;
  for (const c of report.candidates) {
    try {
      const dir = sessionDir(c.assistantId, c.id);
      if (existsSync(dir)) {
        await fs.rm(dir, { recursive: true, force: true });
        deletedSessions++;
        freedBytes += c.sizeBytes;
      }
    } catch {
      // skip the individual failure; continue sweeping
    }
  }
  await touchMarker();
  return {
    deletedSessions,
    // Reported as 0 since artifacts are folded into session dirs now.
    // The "Last run: N session(s), M artifact(s), X freed" UI still
    // renders — sessions carry their artifacts with them.
    deletedArtifacts: 0,
    freedBytes,
    pinnedSkipped: report.pinnedSkipped,
    ttlDays: report.ttlDays,
  };
}

async function readMarker(): Promise<number> {
  try {
    const raw = await fs.readFile(LAST_CLEANUP_MARKER, "utf8");
    return Number(raw.trim()) || 0;
  } catch {
    return 0;
  }
}

async function touchMarker(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(LAST_CLEANUP_MARKER, String(Date.now()));
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

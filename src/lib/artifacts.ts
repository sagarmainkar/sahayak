import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { Artifact } from "@/lib/types";

const ARTIFACTS_DIR = path.join(process.cwd(), "data", "artifacts");

function slugify(s: string) {
  return (s || "artifact")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40) || "artifact";
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

function dirFor(id: string) {
  // Safety: reject traversal
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new Error("bad artifact id");
  return path.join(ARTIFACTS_DIR, id);
}

function metaPath(id: string) {
  return path.join(dirFor(id), "meta.json");
}
function sourcePath(id: string) {
  return path.join(dirFor(id), "source.jsx");
}
function dataFile(id: string, filename: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw new Error("bad filename");
  return path.join(dirFor(id), "files", filename);
}

function hashSource(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
}

// Index of source-hash → id, so re-POSTs of the same code return the same id.
const HASH_INDEX = path.join(ARTIFACTS_DIR, "_by_hash.json");

async function readHashIndex(): Promise<Record<string, string>> {
  if (!existsSync(HASH_INDEX)) return {};
  try {
    return JSON.parse(await fs.readFile(HASH_INDEX, "utf8"));
  } catch {
    return {};
  }
}

async function writeHashIndex(idx: Record<string, string>) {
  await ensureDir(ARTIFACTS_DIR);
  await fs.writeFile(HASH_INDEX, JSON.stringify(idx, null, 2));
}

export async function createArtifact(input: {
  id?: string;
  title: string;
  source: string;
  sessionId?: string | null;
  assistantId?: string | null;
}): Promise<Artifact> {
  const h = hashSource(input.source);
  const idx = await readHashIndex();

  // Dedup: if the source is identical AND we already have an id for it,
  // return that one (just refreshing title/session).
  let id = input.id ?? idx[h];
  if (!id) {
    id = `${slugify(input.title)}-${nanoid(8).replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
    idx[h] = id;
    await writeHashIndex(idx);
  }

  const d = dirFor(id);
  await ensureDir(d);
  await ensureDir(path.join(d, "files"));
  const now = Date.now();
  const existing = await readMeta(id);
  const artifact: Artifact = {
    id,
    title: input.title || existing?.title || "Untitled artifact",
    sessionId: input.sessionId ?? existing?.sessionId ?? null,
    assistantId: input.assistantId ?? existing?.assistantId ?? null,
    source: input.source,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await fs.writeFile(sourcePath(id), input.source, "utf8");
  const meta = { ...artifact };
  delete (meta as Partial<Artifact>).source;
  await fs.writeFile(metaPath(id), JSON.stringify(meta, null, 2));
  return artifact;
}

async function readMeta(id: string): Promise<Artifact | null> {
  const mp = metaPath(id);
  if (!existsSync(mp)) return null;
  const meta = JSON.parse(await fs.readFile(mp, "utf8"));
  const sp = sourcePath(id);
  const source = existsSync(sp) ? await fs.readFile(sp, "utf8") : "";
  return { ...meta, source };
}

export async function getArtifact(id: string): Promise<Artifact | null> {
  return readMeta(id);
}

export async function listArtifacts(opts?: {
  sessionId?: string;
}): Promise<Artifact[]> {
  if (!existsSync(ARTIFACTS_DIR)) return [];
  const ids = await fs.readdir(ARTIFACTS_DIR);
  const out: Artifact[] = [];
  for (const id of ids) {
    const m = await readMeta(id);
    if (!m) continue;
    if (opts?.sessionId && m.sessionId !== opts.sessionId) continue;
    out.push(m);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readDataFile(
  id: string,
  filename: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  let p: string;
  try {
    p = dataFile(id, filename);
  } catch {
    return null;
  }
  if (!existsSync(p)) return null;
  const buffer = await fs.readFile(p);
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mt =
    ({
      csv: "text/csv; charset=utf-8",
      tsv: "text/tab-separated-values; charset=utf-8",
      json: "application/json; charset=utf-8",
      txt: "text/plain; charset=utf-8",
      md: "text/markdown; charset=utf-8",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
    })[ext] ?? "application/octet-stream";
  return { buffer, mimeType: mt };
}

export async function deleteArtifact(id: string) {
  try {
    const d = dirFor(id);
    if (existsSync(d)) await fs.rm(d, { recursive: true, force: true });
  } catch {}
}

// Path the model can use via write_file to place data for an artifact.
export function artifactDataPath(id: string, filename: string) {
  return dataFile(id, filename);
}

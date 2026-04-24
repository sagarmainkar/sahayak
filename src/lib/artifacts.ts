import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Artifact } from "@/lib/types";
import {
  artifactDir,
  artifactsDir,
  isValidFilename,
  isValidIdSegment,
} from "@/lib/paths";

export type ArtifactScope = {
  assistantId: string;
  sessionId: string;
};

function slugify(s: string): string {
  return (s || "artifact")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40) || "artifact";
}

function assertScope(scope: ArtifactScope): void {
  if (!isValidIdSegment(scope.assistantId)) {
    throw new Error(`invalid assistantId: ${scope.assistantId}`);
  }
  if (!isValidIdSegment(scope.sessionId)) {
    throw new Error(`invalid sessionId: ${scope.sessionId}`);
  }
}

function assertArtifactId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) {
    throw new Error(`bad artifact id: ${id}`);
  }
}

function metaPath(scope: ArtifactScope, id: string): string {
  return path.join(artifactDir(scope.assistantId, scope.sessionId, id), "meta.json");
}
function sourcePath(scope: ArtifactScope, id: string): string {
  return path.join(artifactDir(scope.assistantId, scope.sessionId, id), "source.jsx");
}
function dataFilePath(
  scope: ArtifactScope,
  id: string,
  filename: string,
): string {
  if (!isValidFilename(filename)) throw new Error("bad filename");
  return path.join(
    artifactDir(scope.assistantId, scope.sessionId, id),
    "files",
    filename,
  );
}

/** Reserve an artifact dir for this session. No cross-session dedup:
 *  the same source in two sessions lives twice on disk — that's fine
 *  because sessions are the unit of deletion. */
export async function createArtifact(
  scope: ArtifactScope,
  input: {
    id?: string;
    title: string;
    source: string;
  },
): Promise<Artifact> {
  assertScope(scope);
  let id = input.id;
  if (id) {
    assertArtifactId(id);
  } else {
    id = `${slugify(input.title)}-${nanoid(8)
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()}`;
  }
  const dir = artifactDir(scope.assistantId, scope.sessionId, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "files"), { recursive: true });

  const now = Date.now();
  const existing = await readMeta(scope, id);
  const artifact: Artifact = {
    id,
    title: input.title || existing?.title || "Untitled artifact",
    sessionId: scope.sessionId,
    assistantId: scope.assistantId,
    source: input.source,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await fs.writeFile(sourcePath(scope, id), input.source, "utf8");
  const meta = { ...artifact };
  delete (meta as Partial<Artifact>).source;
  await fs.writeFile(metaPath(scope, id), JSON.stringify(meta, null, 2));
  return artifact;
}

async function readMeta(
  scope: ArtifactScope,
  id: string,
): Promise<Artifact | null> {
  const mp = metaPath(scope, id);
  if (!existsSync(mp)) return null;
  const meta = JSON.parse(await fs.readFile(mp, "utf8"));
  const sp = sourcePath(scope, id);
  const source = existsSync(sp) ? await fs.readFile(sp, "utf8") : "";
  return { ...meta, source };
}

export async function updateArtifact(
  scope: ArtifactScope,
  id: string,
  patch: { title?: string },
): Promise<Artifact | null> {
  assertScope(scope);
  assertArtifactId(id);
  const cur = await readMeta(scope, id);
  if (!cur) return null;
  const next: Artifact = {
    ...cur,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    updatedAt: Date.now(),
  };
  const meta = { ...next };
  delete (meta as Partial<Artifact>).source;
  await fs.writeFile(metaPath(scope, id), JSON.stringify(meta, null, 2));
  return next;
}

export async function getArtifact(
  scope: ArtifactScope,
  id: string,
): Promise<Artifact | null> {
  assertScope(scope);
  try {
    assertArtifactId(id);
  } catch {
    return null;
  }
  return readMeta(scope, id);
}

export async function listArtifacts(
  scope: ArtifactScope,
): Promise<Artifact[]> {
  assertScope(scope);
  const root = artifactsDir(scope.assistantId, scope.sessionId);
  if (!existsSync(root)) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const out: Artifact[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) continue;
    let m: Artifact | null = null;
    try {
      m = await readMeta(scope, id);
    } catch {
      continue;
    }
    if (m) out.push(m);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readDataFile(
  scope: ArtifactScope,
  id: string,
  filename: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  assertScope(scope);
  try {
    assertArtifactId(id);
  } catch {
    return null;
  }
  let p: string;
  try {
    p = dataFilePath(scope, id, filename);
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

export async function deleteArtifact(
  scope: ArtifactScope,
  id: string,
): Promise<void> {
  assertScope(scope);
  try {
    assertArtifactId(id);
  } catch {
    return;
  }
  const d = artifactDir(scope.assistantId, scope.sessionId, id);
  if (existsSync(d)) await fs.rm(d, { recursive: true, force: true });
}

/** Path the `artifact_write_file` tool uses to drop data into the
 *  artifact's `files/` subtree. Scoped to session so two sessions'
 *  artifacts can't collide. */
export function artifactDataPath(
  scope: ArtifactScope,
  id: string,
  filename: string,
): string {
  assertScope(scope);
  assertArtifactId(id);
  return dataFilePath(scope, id, filename);
}

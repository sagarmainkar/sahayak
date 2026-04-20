import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
};

export async function ensureUploadsDir() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

export async function saveUpload(
  buffer: Buffer,
  mimeType: string,
): Promise<{ hash: string; ext: string; mimeType: string; bytes: number; url: string }> {
  await ensureUploadsDir();
  const ext = EXT_BY_MIME[mimeType] ?? "bin";
  const hash = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex")
    .slice(0, 16);
  const filename = `${hash}.${ext}`;
  const full = path.join(UPLOADS_DIR, filename);
  if (!existsSync(full)) {
    await fs.writeFile(full, buffer);
  }
  return {
    hash,
    ext,
    mimeType,
    bytes: buffer.byteLength,
    url: `/api/attachment/${filename}`,
  };
}

export async function readUpload(
  filename: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const safe = filename.replace(/[^a-z0-9._-]/gi, "");
  if (!safe || safe !== filename) return null;
  const full = path.join(UPLOADS_DIR, safe);
  if (!existsSync(full)) return null;
  const buffer = await fs.readFile(full);
  const ext = path.extname(safe).slice(1).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  return { buffer, mimeType };
}

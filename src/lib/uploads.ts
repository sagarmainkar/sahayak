import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");
const PY = "/srv/work/agent-tools/.venv/bin/python3";
const EXTRACT_SCRIPT = path.join(
  process.cwd(),
  "python",
  "extract_doc.py",
);

/** Hard cap on inlined extracted text per attachment (characters). */
const DOC_TEXT_CAP = 50_000;

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
};

const DOC_EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "text/markdown": "md",
  "text/plain": "txt",
  "text/csv": "csv",
};

const MIME_BY_EXT: Record<string, string> = {
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  // docs
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
};

export type UploadKind = "image" | "document";

export async function ensureUploadsDir() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

function extOf(mimeType: string, fallbackName?: string): {
  ext: string;
  kind: UploadKind;
} | null {
  if (IMAGE_EXT_BY_MIME[mimeType]) {
    return { ext: IMAGE_EXT_BY_MIME[mimeType], kind: "image" };
  }
  if (DOC_EXT_BY_MIME[mimeType]) {
    return { ext: DOC_EXT_BY_MIME[mimeType], kind: "document" };
  }
  // Browsers report odd MIME types for some files (e.g. markdown often
  // arrives as application/octet-stream); fall back to the filename ext.
  if (fallbackName) {
    const fromName = path.extname(fallbackName).slice(1).toLowerCase();
    if (fromName && MIME_BY_EXT[fromName]) {
      const isImage = !!IMAGE_EXT_BY_MIME[MIME_BY_EXT[fromName]];
      return { ext: fromName, kind: isImage ? "image" : "document" };
    }
  }
  return null;
}

function runExtract(srcPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PY, [EXTRACT_SCRIPT, srcPath]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
      else
        reject(
          new Error(
            `extract ${code}: ${Buffer.concat(err).toString("utf8").trim()}`,
          ),
        );
    });
  });
}

export class PdfEncryptedError extends Error {
  readonly kind = "pdf_encrypted";
  constructor(message: string, readonly badPassword: boolean) {
    super(message);
    this.name = "PdfEncryptedError";
  }
}

function runPdftotext(srcPath: string, password?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args: string[] = ["-layout"];
    // `-upw` = user password (decrypts the file for reading). Provide
    // as owner-password too; harmless if the file doesn't need it.
    if (password) args.push("-upw", password, "-opw", password);
    args.push(srcPath, "-");
    const child = spawn("pdftotext", args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out).toString("utf8"));
        return;
      }
      const stderr = Buffer.concat(err).toString("utf8").trim();
      if (/incorrect password/i.test(stderr)) {
        reject(new PdfEncryptedError(stderr, !!password));
        return;
      }
      reject(new Error(`pdftotext ${code}: ${stderr}`));
    });
  });
}

async function extractDocumentText(
  srcPath: string,
  ext: string,
  password?: string,
): Promise<string> {
  let raw: string;
  if (ext === "pdf") {
    raw = await runPdftotext(srcPath, password);
  } else if (ext === "md" || ext === "txt" || ext === "csv") {
    raw = await fs.readFile(srcPath, "utf8");
  } else if (ext === "docx" || ext === "xlsx" || ext === "pptx") {
    raw = await runExtract(srcPath);
  } else {
    throw new Error(`no extractor for .${ext}`);
  }
  const trimmed = raw.trim();
  if (trimmed.length <= DOC_TEXT_CAP) return trimmed;
  return (
    trimmed.slice(0, DOC_TEXT_CAP) +
    `\n\n[...truncated ${trimmed.length - DOC_TEXT_CAP} chars]`
  );
}

export type SavedUpload = {
  hash: string;
  ext: string;
  mimeType: string;
  bytes: number;
  url: string;
  kind: UploadKind;
  /** Basename of the sidecar text file, for documents only. */
  textFilename?: string;
  /** First ~500 chars of the extracted text — useful for a UI preview. */
  textPreview?: string;
};

export async function saveUpload(
  buffer: Buffer,
  mimeType: string,
  originalName?: string,
  password?: string,
): Promise<SavedUpload> {
  await ensureUploadsDir();
  const meta = extOf(mimeType, originalName);
  if (!meta) throw new Error(`unsupported mime type: ${mimeType}`);
  const { ext, kind } = meta;

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

  let textFilename: string | undefined;
  let textPreview: string | undefined;
  if (kind === "document") {
    const sidecarName = `${filename}.txt`;
    const sidecarPath = path.join(UPLOADS_DIR, sidecarName);
    if (!existsSync(sidecarPath)) {
      const text = await extractDocumentText(full, ext, password);
      await fs.writeFile(sidecarPath, text, "utf8");
    }
    textFilename = sidecarName;
    const snippet = (await fs.readFile(sidecarPath, "utf8")).trim();
    textPreview =
      snippet.length > 500 ? snippet.slice(0, 500) + "…" : snippet;
  }

  return {
    hash,
    ext,
    mimeType: MIME_BY_EXT[ext] ?? mimeType,
    bytes: buffer.byteLength,
    url: `/api/attachment/${filename}`,
    kind,
    ...(textFilename ? { textFilename } : {}),
    ...(textPreview !== undefined ? { textPreview } : {}),
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

export async function readUploadText(
  filename: string,
): Promise<string | null> {
  const safe = filename.replace(/[^a-z0-9._-]/gi, "");
  if (!safe || safe !== filename) return null;
  const full = path.join(UPLOADS_DIR, safe);
  if (!existsSync(full)) return null;
  return await fs.readFile(full, "utf8");
}

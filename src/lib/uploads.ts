import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { OfficeParser } from "officeparser";
import type { OfficeContentNode } from "officeparser";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

// Optional local Python extractor. Users who've run
// `npm run setup:python` get a venv at python/.venv with the
// richer docx/xlsx/pptx parsers AND encrypted-PDF support.
// Users who haven't get the pure-JS officeparser fallback for
// everything except encrypted PDFs (which we can't handle without
// Python since pdfjs-dist doesn't take passwords).
const PY_DIR = path.join(process.cwd(), "python");
const VENV_PY = path.join(
  PY_DIR,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python3",
);
const EXTRACT_SCRIPT = path.join(PY_DIR, "extract_doc.py");
function hasPythonExtractor(): boolean {
  return existsSync(VENV_PY) && existsSync(EXTRACT_SCRIPT);
}

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

/** Recursively concatenate an officeparser AST node's text. Most
 *  nodes carry `.text` pre-flattened; we still walk children for the
 *  container types (sheet → row → cell, slide → paragraph → text) so
 *  nothing slips through. */
function nodeText(node: OfficeContentNode): string {
  const pieces: string[] = [];
  if (typeof node.text === "string" && node.text.length) {
    pieces.push(node.text);
  } else if (node.children && node.children.length) {
    for (const child of node.children) {
      const t = nodeText(child);
      if (t) pieces.push(t);
    }
  }
  return pieces.join(node.type === "cell" ? " | " : "\n");
}

/** Pure-JS fallback: officeparser covers docx/xlsx/pptx/pdf/odt/ods
 *  with zero native deps. Can't decrypt password-protected PDFs — for
 *  those we need the Python path below. */
async function extractWithOfficeparser(srcPath: string): Promise<string> {
  const ast = await OfficeParser.parseOffice(srcPath, {
    extractAttachments: false,
    ocr: false,
    includeRawContent: false,
  });
  const parts: string[] = [];
  for (const node of ast.content) {
    const t = nodeText(node);
    if (t) parts.push(t);
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Thrown when a PDF is encrypted. `badPassword=true` means we tried
 *  a password and it was wrong; `false` means no password was supplied
 *  and one is required. The /api/uploads route surfaces this to the
 *  client so the composer can prompt. */
export class PdfEncryptedError extends Error {
  readonly kind = "pdf_encrypted";
  constructor(message: string, readonly badPassword: boolean) {
    super(message);
    this.name = "PdfEncryptedError";
  }
}

/** Run python/extract_doc.py via the local venv. Translates the
 *  script's exit codes (65 = needs password, 66 = wrong password)
 *  into PdfEncryptedError so the upload route can surface the
 *  password prompt. Returns the extracted text on exit 0. */
function extractWithPython(
  srcPath: string,
  password?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [EXTRACT_SCRIPT, srcPath];
    if (password) args.push("--password", password);
    const child = spawn(VENV_PY, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      const stderr = Buffer.concat(err).toString("utf8").trim();
      if (code === 0) {
        resolve(Buffer.concat(out).toString("utf8"));
        return;
      }
      if (code === 65) {
        reject(new PdfEncryptedError(stderr, false));
        return;
      }
      if (code === 66) {
        reject(new PdfEncryptedError(stderr, true));
        return;
      }
      reject(
        new Error(`extract ${code}: ${stderr.slice(0, 200) || "(no stderr)"}`),
      );
    });
  });
}

async function extractDocumentText(
  srcPath: string,
  ext: string,
  password?: string,
): Promise<string> {
  let raw: string;
  if (ext === "md" || ext === "txt" || ext === "csv") {
    raw = await fs.readFile(srcPath, "utf8");
  } else if (
    ext === "pdf" ||
    ext === "docx" ||
    ext === "xlsx" ||
    ext === "pptx"
  ) {
    // Prefer Python when the venv exists — richer parsers + encrypted
    // PDF support. Without it, officeparser handles everything except
    // encrypted PDFs (those will fail at the parseOffice call with a
    // generic error; we translate to PdfEncryptedError so the UI can
    // still ask for a password and a subsequent request-with-python
    // succeeds if the user sets up the venv).
    if (hasPythonExtractor()) {
      raw = await extractWithPython(srcPath, password);
    } else {
      try {
        raw = await extractWithOfficeparser(srcPath);
      } catch (e) {
        // Heuristic: pdfjs throws a PasswordException / generic Error
        // when asked to read an encrypted PDF. Surface as our typed
        // error so the Composer's password prompt still appears, even
        // though we can't actually satisfy it without Python.
        if (
          ext === "pdf" &&
          /password|encrypt/i.test((e as Error).message)
        ) {
          throw new PdfEncryptedError(
            "Encrypted PDF — run `npm run setup:python` to enable password-based extraction.",
            false,
          );
        }
        throw e;
      }
    }
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

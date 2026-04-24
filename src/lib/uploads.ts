import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { OfficeParser } from "officeparser";
import type { OfficeContentNode } from "officeparser";
import {
  attachmentUrl,
  isValidFilename,
  isValidIdSegment,
  uploadFile,
  uploadsDir,
} from "@/lib/paths";

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

export type UploadScope = {
  assistantId: string;
  sessionId: string;
};

function validateScope(scope: UploadScope): void {
  if (!isValidIdSegment(scope.assistantId)) {
    throw new Error(`invalid assistantId: ${scope.assistantId}`);
  }
  if (!isValidIdSegment(scope.sessionId)) {
    throw new Error(`invalid sessionId: ${scope.sessionId}`);
  }
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

/** Scan the tail of a PDF for `/Encrypt` in the trailer dictionary.
 *  Any encrypted PDF includes this reference; checking explicitly
 *  lets us raise PdfEncryptedError BEFORE officeparser silently
 *  returns empty text on a pdfjs-dist that didn't throw. Reads just
 *  the last ~8KB since the trailer lives at the end. */
async function isPdfEncrypted(srcPath: string): Promise<boolean> {
  const fh = await fs.open(srcPath, "r");
  try {
    const { size } = await fh.stat();
    const windowSize = Math.min(size, 8192);
    const buf = Buffer.alloc(windowSize);
    await fh.read(buf, 0, windowSize, Math.max(0, size - windowSize));
    return buf.toString("latin1").includes("/Encrypt");
  } finally {
    await fh.close();
  }
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
      if (ext === "pdf" && (await isPdfEncrypted(srcPath))) {
        throw new PdfEncryptedError(
          "Encrypted PDF — run `npm run setup:python` to enable password-based extraction.",
          false,
        );
      }
      try {
        raw = await extractWithOfficeparser(srcPath);
      } catch (e) {
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

/** Save `buffer` into `.data/<aid>/<sid>/uploads/<hash>.<ext>`. Each
 *  session owns its uploads; the same file uploaded in two different
 *  sessions lives twice on disk (by design — sessions delete cleanly). */
export async function saveUpload(
  scope: UploadScope,
  buffer: Buffer,
  mimeType: string,
  originalName?: string,
  password?: string,
): Promise<SavedUpload> {
  validateScope(scope);
  const meta = extOf(mimeType, originalName);
  if (!meta) throw new Error(`unsupported mime type: ${mimeType}`);
  const { ext, kind } = meta;

  const dir = uploadsDir(scope.assistantId, scope.sessionId);
  await fs.mkdir(dir, { recursive: true });

  const hash = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex")
    .slice(0, 16);
  const filename = `${hash}.${ext}`;
  const full = uploadFile(scope.assistantId, scope.sessionId, filename);
  if (!existsSync(full)) {
    await fs.writeFile(full, buffer);
  }

  let textFilename: string | undefined;
  let textPreview: string | undefined;
  if (kind === "document") {
    const sidecarName = `${filename}.txt`;
    const sidecarPath = uploadFile(
      scope.assistantId,
      scope.sessionId,
      sidecarName,
    );
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
    url: attachmentUrl(scope.assistantId, scope.sessionId, filename),
    kind,
    ...(textFilename ? { textFilename } : {}),
    ...(textPreview !== undefined ? { textPreview } : {}),
  };
}

export async function readUpload(
  scope: UploadScope,
  filename: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  validateScope(scope);
  if (!isValidFilename(filename)) return null;
  const full = uploadFile(scope.assistantId, scope.sessionId, filename);
  if (!existsSync(full)) return null;
  const buffer = await fs.readFile(full);
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  return { buffer, mimeType };
}

export async function readUploadText(
  scope: UploadScope,
  filename: string,
): Promise<string | null> {
  validateScope(scope);
  if (!isValidFilename(filename)) return null;
  const full = uploadFile(scope.assistantId, scope.sessionId, filename);
  if (!existsSync(full)) return null;
  return await fs.readFile(full, "utf8");
}

import path from "node:path";

/**
 * Central source of truth for every filesystem location Sahayak touches.
 *
 * Two top-level trees:
 *   .config/  — app-scoped config (assistants, mcp, settings, memory).
 *               Small, stable, backs up well, maps cleanly to a Docker
 *               volume mount.
 *   .data/    — user content, session-scoped:
 *               .data/<assistantId>/<sessionId>/
 *                 session.jsonl
 *                 uploads/<filename>        (+ <filename>.txt sidecar)
 *                 artifacts/<artifactId>/ meta.json | source.jsx | files/
 *
 * Delete a session → `rm -rf .data/<aid>/<sid>/` and everything the
 * chat touched goes with it. No dedup across sessions, no cascade,
 * no pinning at the artifact/upload level — the session is the unit.
 *
 * Overridable via env for Docker / alternate hosting:
 *   SAHAYAK_CONFIG_DIR
 *   SAHAYAK_DATA_DIR
 */

const CWD = process.cwd();

export const CONFIG_DIR =
  process.env.SAHAYAK_CONFIG_DIR ?? path.join(CWD, ".config");
export const DATA_DIR =
  process.env.SAHAYAK_DATA_DIR ?? path.join(CWD, ".data");

// ── .config/ file paths ──────────────────────────────────────────────
export const ASSISTANTS_FILE = path.join(CONFIG_DIR, "assistants.json");
export const MCP_FILE = path.join(CONFIG_DIR, "mcp.json");
export const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");
export const MEMORY_FILE = path.join(CONFIG_DIR, "memory.jsonl");
export const MEMORY_VEC_FILE = path.join(CONFIG_DIR, "memory.vec.jsonl");

// ── .data/ sweep marker ──────────────────────────────────────────────
export const LAST_CLEANUP_MARKER = path.join(DATA_DIR, ".last_cleanup");

// ── per-session paths ────────────────────────────────────────────────
export function assistantDir(assistantId: string): string {
  return path.join(DATA_DIR, assistantId);
}
export function sessionDir(
  assistantId: string,
  sessionId: string,
): string {
  return path.join(DATA_DIR, assistantId, sessionId);
}
export function sessionFile(
  assistantId: string,
  sessionId: string,
): string {
  return path.join(sessionDir(assistantId, sessionId), "session.jsonl");
}
export function uploadsDir(
  assistantId: string,
  sessionId: string,
): string {
  return path.join(sessionDir(assistantId, sessionId), "uploads");
}
export function uploadFile(
  assistantId: string,
  sessionId: string,
  filename: string,
): string {
  return path.join(uploadsDir(assistantId, sessionId), filename);
}
export function artifactsDir(
  assistantId: string,
  sessionId: string,
): string {
  return path.join(sessionDir(assistantId, sessionId), "artifacts");
}
export function artifactDir(
  assistantId: string,
  sessionId: string,
  artifactId: string,
): string {
  return path.join(artifactsDir(assistantId, sessionId), artifactId);
}

// ── URL builders (client + server agree via this module) ─────────────
export function attachmentUrl(
  assistantId: string,
  sessionId: string,
  filename: string,
): string {
  return `/api/attachment/${encodeURIComponent(assistantId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(filename)}`;
}
export function artifactDataUrl(
  assistantId: string,
  sessionId: string,
  artifactId: string,
  file: string,
): string {
  return `/api/artifact-data/${encodeURIComponent(assistantId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(artifactId)}/${encodeURIComponent(file)}`;
}
export function artifactUrl(
  assistantId: string,
  sessionId: string,
  artifactId: string,
): string {
  return `/api/artifacts/${encodeURIComponent(assistantId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(artifactId)}`;
}

// ── safety helpers for route params ──────────────────────────────────
/** Accept alnum + `-`, `_` only. Everything we generate (nanoid,
 *  derived ids) fits this; anything else is a caller mistake or
 *  path-traversal attempt. */
export function isValidIdSegment(s: string): boolean {
  return s.length > 0 && s.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(s);
}
/** Filenames stay content-addressed (hash.ext) so they're tight:
 *  alnum + `.`, `-`, `_`. Explicit `..` rejection belt + suspenders. */
export function isValidFilename(s: string): boolean {
  return (
    s.length > 0 &&
    s.length <= 128 &&
    /^[a-zA-Z0-9._-]+$/.test(s) &&
    !s.includes("..")
  );
}

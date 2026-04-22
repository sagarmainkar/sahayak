import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATA_DIR = path.join(process.cwd(), "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

const MAX_HITS = 40;
const SNIPPET_RADIUS = 70;
const MAX_MATCHES_PER_SESSION = 3;

type SearchMatch = {
  role: "user" | "assistant" | "tool" | "system";
  snippet: string;
  matchStart: number;
  matchLen: number;
};

type SearchHit = {
  sessionId: string;
  assistantId: string;
  title: string;
  updatedAt: number;
  matchCount: number;
  matches: SearchMatch[];
};

function snippetAround(
  text: string,
  matchIdx: number,
  matchLen: number,
): { snippet: string; matchStart: number } {
  const start = Math.max(0, matchIdx - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIdx + matchLen + SNIPPET_RADIUS);
  let slice = text.slice(start, end);
  let prefixTrimmed = 0;
  if (start > 0) {
    // Nudge to next whitespace so we don't cut mid-word.
    const ws = slice.search(/\s/);
    if (ws > 0 && ws < SNIPPET_RADIUS) {
      slice = slice.slice(ws + 1);
      prefixTrimmed = ws + 1;
    }
  }
  if (end < text.length) {
    const lastWs = slice.lastIndexOf(" ");
    if (lastWs > slice.length - SNIPPET_RADIUS) {
      slice = slice.slice(0, lastWs);
    }
  }
  // Collapse whitespace to single spaces for display; recompute the
  // match offset post-trim.
  const preEllipsis = start > 0 ? "…" : "";
  const postEllipsis = end < text.length ? "…" : "";
  const rawMatchOffsetInSlice = matchIdx - start - prefixTrimmed;
  const cleaned = `${preEllipsis}${slice}${postEllipsis}`.replace(
    /[\t\n\r]+/g,
    " ",
  );
  return {
    snippet: cleaned,
    matchStart: Math.max(0, rawMatchOffsetInSlice + preEllipsis.length),
  };
}

type SessionMessage = {
  role?: string;
  content?: unknown;
  thinking?: unknown;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
};

type MetaRecord = {
  type: "meta";
  id: string;
  assistantId: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
};

async function scanFile(
  filePath: string,
  assistantId: string,
  needle: string,
): Promise<SearchHit | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  if (!lines.length) return null;
  let meta: MetaRecord | null = null;
  try {
    const m = JSON.parse(lines[0]) as MetaRecord;
    if (m.type === "meta") meta = m;
  } catch {
    return null;
  }
  if (!meta) return null;

  const lower = needle.toLowerCase();
  const needleLen = needle.length;
  const matches: SearchMatch[] = [];
  let totalMatches = 0;

  // Title match counts as a match but doesn't consume a slot in the
  // visible match list unless we have nothing else.
  const titleLower = meta.title.toLowerCase();
  let titleSnippet: SearchMatch | null = null;
  if (titleLower.includes(lower)) {
    const idx = titleLower.indexOf(lower);
    const s = snippetAround(meta.title, idx, needleLen);
    titleSnippet = {
      role: "system",
      snippet: `title · ${s.snippet}`,
      matchStart: s.matchStart + "title · ".length,
      matchLen: needleLen,
    };
    totalMatches += 1;
  }

  for (
    let i = 1;
    i < lines.length && matches.length < MAX_MATCHES_PER_SESSION;
    i++
  ) {
    const line = lines[i];
    if (!line) continue;
    let parsed: { type: string; data?: SessionMessage };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.type !== "message" || !parsed.data) continue;
    const m = parsed.data;
    const role: SearchMatch["role"] =
      m.role === "user" || m.role === "assistant" || m.role === "tool"
        ? m.role
        : "system";
    const haystacks: string[] = [];
    if (typeof m.content === "string" && m.content) haystacks.push(m.content);
    if (typeof m.thinking === "string" && m.thinking) haystacks.push(m.thinking);
    if (m.toolArgs && typeof m.toolArgs === "object") {
      try {
        haystacks.push(JSON.stringify(m.toolArgs));
      } catch {}
    }
    for (const h of haystacks) {
      const hay = h.toLowerCase();
      const idx = hay.indexOf(lower);
      if (idx < 0) continue;
      totalMatches += 1;
      if (matches.length >= MAX_MATCHES_PER_SESSION) break;
      const s = snippetAround(h, idx, needleLen);
      matches.push({
        role,
        snippet: s.snippet,
        matchStart: s.matchStart,
        matchLen: needleLen,
      });
    }
  }

  if (matches.length === 0 && titleSnippet) {
    matches.push(titleSnippet);
  } else if (titleSnippet && matches.length < MAX_MATCHES_PER_SESSION) {
    matches.unshift(titleSnippet);
  }

  if (!matches.length) return null;
  return {
    sessionId: meta.id,
    assistantId,
    title: meta.title,
    updatedAt: meta.updatedAt,
    matchCount: totalMatches,
    matches,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const scope = url.searchParams.get("scope") ?? "current";
  const assistantId = url.searchParams.get("assistant") ?? "";
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const assistantDirs: string[] = [];
  if (scope === "all" || !assistantId) {
    if (existsSync(SESSIONS_DIR)) {
      const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
      for (const e of entries) if (e.isDirectory()) assistantDirs.push(e.name);
    }
  } else {
    assistantDirs.push(assistantId);
  }

  const hits: SearchHit[] = [];
  outer: for (const aid of assistantDirs) {
    const dir = path.join(SESSIONS_DIR, aid);
    if (!existsSync(dir)) continue;
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const hit = await scanFile(path.join(dir, f), aid, q);
      if (hit) hits.push(hit);
      if (hits.length >= MAX_HITS * 2) break outer;
    }
  }

  const sorted = hits
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_HITS);
  return NextResponse.json({ hits: sorted });
}

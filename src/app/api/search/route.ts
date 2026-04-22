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

type Match = {
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
  matches: Match[];
};

/** Returns a ~140-char window around `idx` with word-boundary trimming
 *  and an ellipsis where we cut. `matchStart` is the offset of the
 *  match inside the returned snippet, accounting for the leading
 *  ellipsis. */
function snippetAround(
  text: string,
  idx: number,
  queryLen: number,
): { snippet: string; matchStart: number } {
  const rawStart = Math.max(0, idx - SNIPPET_RADIUS);
  const rawEnd = Math.min(text.length, idx + queryLen + SNIPPET_RADIUS);
  let start = rawStart;
  let prefix = "";
  if (start > 0) {
    const lead = text.slice(rawStart, idx);
    const ws = lead.search(/\s/);
    if (ws >= 0 && ws < SNIPPET_RADIUS - 10) start = rawStart + ws + 1;
    prefix = "…";
  }
  let end = rawEnd;
  let suffix = "";
  if (end < text.length) {
    const trail = text.slice(idx + queryLen, rawEnd);
    const ws = trail.search(/\s(?=\S*$)/);
    if (ws > 0) end = idx + queryLen + ws;
    suffix = "…";
  }
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  const matchStart = prefix.length + (idx - start);
  return {
    snippet: `${prefix}${body}${suffix}`,
    matchStart: Math.max(0, matchStart),
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
  const matches: Match[] = [];
  let matchCount = 0;

  // Title — cheap virtual "system" role so UI can distinguish if useful.
  const titleLower = meta.title.toLowerCase();
  if (titleLower.includes(lower)) {
    matchCount++;
    const idx = titleLower.indexOf(lower);
    const { snippet, matchStart } = snippetAround(
      meta.title,
      idx,
      needle.length,
    );
    matches.push({
      role: "system",
      snippet: `title · ${snippet}`,
      matchStart: matchStart + "title · ".length,
      matchLen: needle.length,
    });
  }

  for (let i = 1; i < lines.length; i++) {
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
    const haystacks: string[] = [];
    if (typeof m.content === "string" && m.content) haystacks.push(m.content);
    if (typeof m.thinking === "string" && m.thinking)
      haystacks.push(m.thinking);
    if (m.toolArgs && typeof m.toolArgs === "object") {
      haystacks.push(JSON.stringify(m.toolArgs));
    }
    for (const text of haystacks) {
      const hay = text.toLowerCase();
      const idx = hay.indexOf(lower);
      if (idx < 0) continue;
      matchCount++;
      if (matches.length < MAX_MATCHES_PER_SESSION) {
        const { snippet, matchStart } = snippetAround(text, idx, needle.length);
        matches.push({
          role:
            m.role === "user" || m.role === "assistant" || m.role === "tool"
              ? m.role
              : "system",
          snippet,
          matchStart,
          matchLen: needle.length,
        });
      }
    }
  }

  if (matchCount === 0) return null;
  return {
    sessionId: meta.id,
    assistantId,
    title: meta.title,
    updatedAt: meta.updatedAt,
    matchCount,
    matches,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const scope = url.searchParams.get("scope") ?? "current";
  const assistantId = url.searchParams.get("assistant") ?? "";
  if (!q || q.length < 2) return NextResponse.json({ hits: [] });

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
      if (hits.length >= MAX_HITS) break outer;
    }
  }

  hits.sort((a, b) => b.updatedAt - a.updatedAt);
  return NextResponse.json({ hits: hits.slice(0, MAX_HITS) });
}

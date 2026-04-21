import { NextResponse } from "next/server";
import { isValidMemoryType, searchMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  const limitRaw = Number(body?.limit ?? 5);
  const limit = Math.max(1, Math.min(20, Number.isFinite(limitRaw) ? limitRaw : 5));
  const type = isValidMemoryType(body?.type) ? body.type : undefined;
  const hits = await searchMemory(query, { limit, ...(type ? { type } : {}) });
  return NextResponse.json({ results: hits });
}

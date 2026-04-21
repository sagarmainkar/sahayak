import { NextResponse } from "next/server";
import { createMemory, listMemories, isValidMemoryType } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const memories = await listMemories();
  return NextResponse.json({ memories });
}

export async function POST(req: Request) {
  const body = await req.json();
  const type = body?.type;
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!isValidMemoryType(type)) {
    return NextResponse.json({ error: "bad type" }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  const source = body?.source === "model" ? "model" : "user";
  const entry = await createMemory({
    type,
    content,
    source,
    sessionId: typeof body?.sessionId === "string" ? body.sessionId : undefined,
  });
  return NextResponse.json({ memory: entry });
}

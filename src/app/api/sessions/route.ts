import { NextResponse } from "next/server";
import { createSession, listSessions } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const assistantId = url.searchParams.get("assistantId");
  if (!assistantId)
    return NextResponse.json({ error: "assistantId required" }, { status: 400 });
  const sessions = await listSessions(assistantId);
  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.assistantId)
    return NextResponse.json({ error: "assistantId required" }, { status: 400 });
  const session = await createSession(body.assistantId, {
    title: body.title,
    messages: body.messages,
    modelOverride: body.modelOverride,
  });
  return NextResponse.json({ session });
}

import { NextResponse } from "next/server";
import { createSession, listSessions } from "@/lib/store";
import { maybeSweep } from "@/lib/cleanup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const assistantId = url.searchParams.get("assistantId");
  if (!assistantId)
    return NextResponse.json({ error: "assistantId required" }, { status: 400 });
  // Fire-and-forget lazy sweep. No-ops unless > 24h since last run.
  maybeSweep();
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

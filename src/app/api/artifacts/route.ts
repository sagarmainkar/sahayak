import { NextResponse } from "next/server";
import { createArtifact, listArtifacts } from "@/lib/artifacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") ?? undefined;
  const items = await listArtifacts({ sessionId });
  return NextResponse.json({ artifacts: items });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.source || typeof body.source !== "string") {
    return NextResponse.json(
      { error: "source required" },
      { status: 400 },
    );
  }
  const a = await createArtifact({
    id: body.id,
    title: body.title ?? "Untitled",
    source: body.source,
    sessionId: body.sessionId ?? null,
    assistantId: body.assistantId ?? null,
  });
  return NextResponse.json({ artifact: a });
}

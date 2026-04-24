import { NextResponse } from "next/server";
import { getArtifact, deleteArtifact, updateArtifact } from "@/lib/artifacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = Promise<{
  assistantId: string;
  sessionId: string;
  id: string;
}>;

export async function GET(_req: Request, { params }: { params: Params }) {
  const { assistantId, sessionId, id } = await params;
  const a = await getArtifact({ assistantId, sessionId }, id);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ artifact: a });
}

export async function PATCH(req: Request, { params }: { params: Params }) {
  const { assistantId, sessionId, id } = await params;
  const body = await req.json();
  const patch: { title?: string } = {};
  if (typeof body?.title === "string") patch.title = body.title;
  const a = await updateArtifact({ assistantId, sessionId }, id, patch);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ artifact: a });
}

export async function DELETE(_req: Request, { params }: { params: Params }) {
  const { assistantId, sessionId, id } = await params;
  await deleteArtifact({ assistantId, sessionId }, id);
  return NextResponse.json({ ok: true });
}

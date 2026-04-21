import { NextResponse } from "next/server";
import { getArtifact, deleteArtifact, updateArtifact } from "@/lib/artifacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const a = await getArtifact(id);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ artifact: a });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const patch: { pinned?: boolean; title?: string } = {};
  if (typeof body?.pinned === "boolean") patch.pinned = body.pinned;
  if (typeof body?.title === "string") patch.title = body.title;
  const a = await updateArtifact(id, patch);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ artifact: a });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteArtifact(id);
  return NextResponse.json({ ok: true });
}

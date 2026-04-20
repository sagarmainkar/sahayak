import { NextResponse } from "next/server";
import { getArtifact, deleteArtifact } from "@/lib/artifacts";

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

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteArtifact(id);
  return NextResponse.json({ ok: true });
}

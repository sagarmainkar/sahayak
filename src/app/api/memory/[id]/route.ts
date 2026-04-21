import { NextResponse } from "next/server";
import {
  deleteMemory,
  getMemory,
  isValidMemoryType,
  updateMemory,
} from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const m = await getMemory(id);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ memory: m });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const content =
    typeof body?.content === "string" ? body.content.trim() : undefined;
  const type = isValidMemoryType(body?.type) ? body.type : undefined;
  if (content === undefined && type === undefined) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  const updated = await updateMemory(id, {
    ...(content !== undefined ? { content } : {}),
    ...(type !== undefined ? { type } : {}),
  });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ memory: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const removed = await deleteMemory(id);
  if (!removed) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

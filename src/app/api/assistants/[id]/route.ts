import { NextResponse } from "next/server";
import { deleteAssistant, getAssistant, updateAssistant } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const assistant = await getAssistant(id);
  if (!assistant) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ assistant });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const assistant = await updateAssistant(id, body);
  if (!assistant) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ assistant });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteAssistant(id);
  return NextResponse.json({ ok: true });
}

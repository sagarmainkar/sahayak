import { NextResponse } from "next/server";
import {
  removeServer,
  setServerEnabled,
  reconnectServer,
} from "@/lib/mcp/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await removeServer(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const updated = await setServerEnabled(id, !!body.enabled);
  if (!updated) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ server: updated });
}

/** POST /api/mcp/:id — reconnect and relist tools. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { status, tools } = await reconnectServer(id);
  return NextResponse.json({
    status,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
    })),
  });
}

import { NextResponse } from "next/server";
import { computeAssistantStats } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const stats = await computeAssistantStats(id);
  if (!stats)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ stats });
}

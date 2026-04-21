import { NextResponse } from "next/server";
import { computeGlobalStats } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const stats = await computeGlobalStats();
  return NextResponse.json(stats);
}

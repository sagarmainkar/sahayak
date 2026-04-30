import { NextResponse } from "next/server";
import { getRecalledAtMap } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ recalledAt: await getRecalledAtMap() });
}

import { NextResponse } from "next/server";
import { getMemoryHealth } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getMemoryHealth());
}

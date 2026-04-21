import { NextResponse } from "next/server";
import { rebuildVectors } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const result = await rebuildVectors();
  return NextResponse.json(result);
}

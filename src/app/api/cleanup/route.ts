import { NextResponse } from "next/server";
import { previewSweep, runSweep } from "@/lib/cleanup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const report = await previewSweep();
  return NextResponse.json(report);
}

export async function POST() {
  const result = await runSweep();
  return NextResponse.json(result);
}

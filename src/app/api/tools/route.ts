import { NextResponse } from "next/server";
import { publicList } from "@/lib/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const tools = await publicList();
  return NextResponse.json({ tools });
}

import { NextResponse } from "next/server";
import { BASE_SYSTEM_PROMPT } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ systemPrompt: BASE_SYSTEM_PROMPT });
}

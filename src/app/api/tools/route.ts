import { NextResponse } from "next/server";
import { publicList } from "@/lib/tools";

export async function GET() {
  return NextResponse.json({ tools: publicList() });
}

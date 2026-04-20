import { NextResponse } from "next/server";
import { createAssistant, listAssistants } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const assistants = await listAssistants();
  return NextResponse.json({ assistants });
}

export async function POST(req: Request) {
  const body = await req.json();
  const assistant = await createAssistant(body);
  return NextResponse.json({ assistant });
}

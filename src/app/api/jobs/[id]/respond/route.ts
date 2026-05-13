import { NextResponse } from "next/server";
import { getJob, resolveUserInput } from "@/lib/jobRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const { answer } = body;

  if (typeof answer !== "string" || !answer.trim()) {
    return NextResponse.json(
      { error: "answer is required" },
      { status: 400 },
    );
  }

  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  const ok = resolveUserInput(id, answer.trim());
  if (!ok) {
    return NextResponse.json(
      { error: "no pending user input request" },
      { status: 410 },
    );
  }

  return NextResponse.json({ ok: true });
}

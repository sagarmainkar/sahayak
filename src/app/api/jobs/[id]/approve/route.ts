import { NextResponse } from "next/server";
import { getJob, resolveApproval } from "@/lib/jobRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const { decision, autoApproveTools } = body;

  if (decision !== "approve" && decision !== "deny" && decision !== "cancel") {
    return NextResponse.json({ error: "decision must be approve, deny, or cancel" }, { status: 400 });
  }

  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  if (autoApproveTools !== undefined) {
    job.autoApproveTools = autoApproveTools;
  }

  const ok = resolveApproval(id, decision);
  if (!ok) {
    return NextResponse.json({ error: "no pending approval (already resolved or expired)" }, { status: 410 });
  }

  return NextResponse.json({ ok: true });
}

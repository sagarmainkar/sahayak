import { NextResponse } from "next/server";
import { getJob, abortJob } from "@/lib/jobRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  const { pendingApproval } = job;
  return NextResponse.json({
    id: job.id,
    assistantId: job.assistantId,
    sessionId: job.sessionId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    eventCount: job.events.length,
    pendingApproval: pendingApproval
      ? { token: pendingApproval.token, toolName: pendingApproval.toolName, arguments: pendingApproval.arguments }
      : null,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = abortJob(id);
  if (!ok) {
    return NextResponse.json({ error: "job not found or not abortable" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

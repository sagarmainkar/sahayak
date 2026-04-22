import { NextResponse } from "next/server";
import { takePaused } from "@/lib/approvalStore";
import { runToolLoop } from "@/lib/toolLoop";
import { resumePiRun } from "@/lib/toolLoopPi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResumeRequest = {
  token: string;
  decision: "approve" | "deny";
  /** Updated session allowlist — "approve for session" adds the tool name
   *  client-side, then posts the new list here so subsequent tool calls
   *  in the same loop skip approval. */
  autoApproveTools?: string[];
};

export async function POST(req: Request) {
  const body = (await req.json()) as ResumeRequest;
  const { token, decision } = body;
  if (!token || (decision !== "approve" && decision !== "deny")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const usePi = process.env.SAHAYAK_LLM_BACKEND === "pi";

  if (usePi) {
    // pi-mono resume: Agent is still running in-memory; we just rebind our
    // SSE translator to this new response and resolve the decision. The
    // stream stays open until agent_end or the next pause.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await resumePiRun(token, decision, body.autoApproveTools, controller);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  const state = takePaused(token);
  if (!state) {
    return NextResponse.json(
      { error: "no pending approval for token (expired or already resolved)" },
      { status: 410 },
    );
  }
  if (body.autoApproveTools) {
    state.autoApproveTools = body.autoApproveTools;
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await runToolLoop(state, controller, decision);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

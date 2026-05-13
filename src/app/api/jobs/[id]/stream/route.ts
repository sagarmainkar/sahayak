import { getJob, subscribe } from "@/lib/jobRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TERMINAL: Set<string> = new Set(["completed", "failed", "aborted"]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const job = getJob(id);
  if (!job) {
    return new Response("job not found", { status: 404 });
  }

  const lastEventIdHeader = req.headers.get("last-event-id");
  const lastEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0;
  const fromId = isNaN(lastEventId) ? 0 : lastEventId + 1;

  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function enqueue(chunk: string) {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          // client disconnected
        }
      }

      const unsub = subscribe(id, fromId, (event) => {
        enqueue(`id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`);
      });

      if (unsub === null) {
        enqueue(`data: ${JSON.stringify({ type: "error", message: "job not found" })}\n\n`);
        controller.close();
        return;
      }

      if (TERMINAL.has(job.status)) {
        setTimeout(() => {
          unsub();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }, 50);
        return;
      }

      req.signal.addEventListener("abort", () => {
        unsub();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}

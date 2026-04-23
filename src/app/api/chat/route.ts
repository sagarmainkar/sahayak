import {
  DEFAULT_REQUIRE_APPROVAL,
  filterArtifactTools,
  injectArtifactInstructions,
  runToolLoop,
  toOllamaMessages,
  type ClientMsg,
} from "@/lib/toolLoop";
import { startPiRun } from "@/lib/toolLoopPi";
import { buildAlwaysInjectedBlock } from "@/lib/memory";
import { deriveCtxModel } from "@/lib/ollama";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChatRequest = {
  model: string;
  messages: ClientMsg[];
  system?: string;
  think?: boolean | "low" | "medium" | "high";
  enabledTools?: string[];
  maxToolTurns?: number;
  /** When true, append REACT_ARTIFACT_INSTRUCTIONS to the last user
   *  message — the Composer toggle. */
  artifactsEnabled?: boolean;
  /** Tool names the user has pre-approved for the current session. Skips
   *  the per-call approval gate for these. */
  autoApproveTools?: string[];
  /** Tool names that always require user approval. Server has a sensible
   *  default; client can override (future per-assistant config). */
  requireApproval?: string[];
  /** Per-assistant context-window override. When set, Sahayak derives a
   *  sibling Ollama model with num_ctx baked in and uses that here. */
  contextLength?: number;
};

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;

  const enabled = filterArtifactTools(
    body.enabledTools ?? [],
    !!body.artifactsEnabled,
  );
  const clientMsgs = body.artifactsEnabled
    ? injectArtifactInstructions(body.messages)
    : body.messages;

  // Always-on memory: prepend facts + preferences to the system prompt.
  // Computed fresh on every request so edits in /memory reflect
  // immediately, no session re-open required. The other memory types
  // (episodic / procedural / event / semantic) stay retrieval-on-demand
  // via the recall_memory tool.
  const memBlock = await buildAlwaysInjectedBlock();
  const systemWithMemory = memBlock
    ? `${memBlock}\n\n---\n\n${body.system ?? ""}`.trim()
    : body.system;

  // pi-mono is the default backend. Set SAHAYAK_LLM_BACKEND=native
  // only as an escape hatch to fall back to the original Ollama loop
  // (kept around for a while longer so we can still compare).
  const usePi = process.env.SAHAYAK_LLM_BACKEND !== "native";

  // Resolve the effective model name. If the assistant has a
  // contextLength override, Sahayak auto-derives a sibling Ollama
  // model with that num_ctx baked in (idempotent: reuses existing).
  // Failures fall back to the base model — the turn still runs, just
  // without the overridden context window.
  let effectiveModel = body.model;
  if (body.contextLength && body.contextLength > 0) {
    try {
      effectiveModel = await deriveCtxModel(body.model, body.contextLength);
    } catch (e) {
      console.error("[ctx override] derive failed:", (e as Error).message);
      effectiveModel = body.model;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (usePi) {
        // pi-mono path: convert ClientMsg → pi-ai Message inside the loop.
        // The run is fire-and-forget; the loop closes the controller on
        // agent_end or on a pause (tool_approval_required).
        await startPiRun(
          {
            systemPrompt: systemWithMemory ?? "",
            clientMessages: clientMsgs,
            model: effectiveModel,
            think: body.think ?? "medium",
            enabledTools: enabled,
            autoApproveTools: body.autoApproveTools ?? [],
            requireApproval: body.requireApproval ?? DEFAULT_REQUIRE_APPROVAL,
            maxToolTurns: body.maxToolTurns ?? 100,
          },
          controller,
        );
        return;
      }

      const messages = await toOllamaMessages(clientMsgs, systemWithMemory);
      await runToolLoop(
        {
          createdAt: Date.now(),
          messages,
          pendingToolCalls: [],
          pendingApprovalIndex: 0,
          turn: 0,
          model: effectiveModel,
          think: body.think ?? "medium",
          enabledTools: enabled,
          autoApproveTools: body.autoApproveTools ?? [],
          requireApproval: body.requireApproval ?? DEFAULT_REQUIRE_APPROVAL,
          maxToolTurns: body.maxToolTurns ?? 100,
          artifactsEnabled: !!body.artifactsEnabled,
        },
        controller,
      );
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

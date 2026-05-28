import { NextResponse } from "next/server";
import {
  DEFAULT_REQUIRE_APPROVAL,
  filterArtifactTools,
  injectArtifactInstructions,
  type ClientMsg,
} from "@/lib/toolLoop";
import {
  buildAlwaysInjectedBlock,
  getRecallContext,
  retryPendingVectors,
} from "@/lib/memory";
import { deriveCtxModel } from "@/lib/ollama";
import { normalizeOpenAiBaseUrl } from "@/lib/piAdapters";
import { readSettings } from "@/lib/settings";
import { createJob, listActiveJobs } from "@/lib/jobRegistry";
import { spawnJobRunner } from "@/lib/jobRunner";
import type { AssistantProvider } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JobRequest = {
  model: string;
  messages: ClientMsg[];
  system?: string;
  think?: boolean | "low" | "medium" | "high";
  enabledTools?: string[];
  maxToolTurns?: number;
  artifactsEnabled?: boolean;
  autoApproveTools?: string[];
  requireApproval?: string[];
  contextLength?: number;
  assistantId: string;
  sessionId: string;
  provider?: AssistantProvider;
  llamaUrl?: string;
  /** Worker model config. Mirrors Assistant.worker. */
  worker?: {
    model: string;
    provider?: AssistantProvider;
    llamaUrl?: string;
    bedrockRegion?: string;
    systemPrompt?: string;
  };
};

export async function POST(req: Request) {
  const body = (await req.json()) as JobRequest;

  if (!body.assistantId || !body.sessionId) {
    return NextResponse.json(
      { error: "missing scope: assistantId and sessionId are required" },
      { status: 400 },
    );
  }

  const enabled = filterArtifactTools(
    body.enabledTools ?? [],
    !!body.artifactsEnabled,
  );
  const clientMsgs = body.artifactsEnabled
    ? injectArtifactInstructions(body.messages)
    : body.messages;

  const memBlock = await buildAlwaysInjectedBlock();
  const lastUser = [...body.messages]
    .reverse()
    .find((m) => m.role === "user");
  const userMessageText =
    typeof lastUser?.content === "string" ? lastUser.content : "";
  const recallBlock = userMessageText
    ? await getRecallContext(userMessageText)
    : "";
  const userTurnCount = clientMsgs.filter((m) => m.role === "user").length;
  const NUDGE_EVERY = 4;
  const nudge =
    userTurnCount > 0 && userTurnCount % NUDGE_EVERY === 0
      ? "[memory check: if anything durable about the user, their environment, or their lasting preferences has emerged in this conversation that wasn't already saved, call remember now. Otherwise reply normally.]"
      : "";
  void retryPendingVectors(5).catch(() => {});

  const parts: string[] = [];
  if (memBlock) parts.push(memBlock);
  if (recallBlock) parts.push(recallBlock);
  if (body.system) parts.push(body.system);
  if (nudge) parts.push(nudge);
  const systemWithMemory = parts.length
    ? parts.join("\n\n---\n\n").trim()
    : body.system;

  const provider: AssistantProvider = body.provider ?? "ollama";
  let llamaBaseUrl: string | undefined;
  let bedrockRegion: string | undefined;
  if (provider === "llama-cpp") {
    if (!body.llamaUrl) {
      return NextResponse.json(
        { error: "llama-cpp provider requires llamaUrl" },
        { status: 400 },
      );
    }
    const normalized = normalizeOpenAiBaseUrl(body.llamaUrl);
    if (!normalized) {
      return NextResponse.json(
        { error: `invalid llamaUrl: ${body.llamaUrl}` },
        { status: 400 },
      );
    }
    llamaBaseUrl = normalized;
  } else if (provider === "bedrock") {
    const settings = await readSettings();
    bedrockRegion = settings.bedrock.region || undefined;
  }

  let effectiveModel = body.model;
  if (provider === "ollama" && body.contextLength && body.contextLength > 0) {
    try {
      effectiveModel = await deriveCtxModel(body.model, body.contextLength);
    } catch (e) {
      console.error("[ctx override] derive failed:", (e as Error).message);
      effectiveModel = body.model;
    }
  }

  const job = createJob(
    body.assistantId,
    body.sessionId,
    body.autoApproveTools ?? [],
  );

  spawnJobRunner({
    jobId: job.id,
    systemPrompt: systemWithMemory ?? "",
    clientMessages: clientMsgs,
    model: effectiveModel,
    think: body.think ?? "medium",
    enabledTools: enabled,
    autoApproveTools: body.autoApproveTools ?? [],
    requireApproval: body.requireApproval ?? DEFAULT_REQUIRE_APPROVAL,
    maxToolTurns: body.maxToolTurns ?? 100,
    assistantId: body.assistantId,
    sessionId: body.sessionId,
    provider,
    llamaBaseUrl,
    bedrockRegion,
    workerConfig: body.worker,
  });

  return NextResponse.json({ jobId: job.id }, { status: 201 });
}

export async function GET() {
  const jobs = listActiveJobs();
  return NextResponse.json({
    jobs: jobs.map(({ id, assistantId, sessionId, status, createdAt }) => ({
      id,
      assistantId,
      sessionId,
      status,
      createdAt,
    })),
  });
}

import { NextResponse } from "next/server";
import {
  getLlamaStatus,
  loadModel,
  unloadModel,
  scanAvailableModels,
  getGpuStats,
  type LlamaLoadConfig,
} from "@/lib/llamaManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const section = url.searchParams.get("section");

  // Single-section fetches for granular polling
  if (section === "status") {
    const status = await getLlamaStatus();
    return NextResponse.json({ status });
  }
  if (section === "gpu") {
    const gpu = await getGpuStats();
    return NextResponse.json({ gpu });
  }
  if (section === "models") {
    const models = await scanAvailableModels();
    return NextResponse.json({ models });
  }

  // Combined fetch for initial load
  const [status, gpu, models] = await Promise.all([
    getLlamaStatus(),
    getGpuStats(),
    scanAvailableModels(),
  ]);
  return NextResponse.json({ status, gpu, models });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    action: "load" | "unload";
    config?: LlamaLoadConfig;
  };

  if (body.action === "unload") {
    const result = await unloadModel();
    const status = await getLlamaStatus();
    if (!result.killed && result.external) {
      return NextResponse.json({
        ok: false,
        error: "Server was started outside Sahayak and cannot be stopped from here.",
        status,
      });
    }
    if (!result.killed) {
      return NextResponse.json({
        ok: false,
        error: "No running server found to stop.",
        status,
      });
    }
    return NextResponse.json({ ok: true, status });
  }

  if (body.action === "load") {
    if (!body.config || !body.config.modelPath) {
      return NextResponse.json(
        { ok: false, error: "Missing config.modelPath" },
        { status: 400 },
      );
    }
    const result = await loadModel(body.config);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 500 },
      );
    }
    const status = await getLlamaStatus();
    return NextResponse.json({ ok: true, status });
  }

  return NextResponse.json(
    { ok: false, error: "Unknown action" },
    { status: 400 },
  );
}

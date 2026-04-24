import { NextResponse } from "next/server";
import { isDerivedByUs, listModels, showModel } from "@/lib/ollama";
import { normalizeOpenAiBaseUrl } from "@/lib/piAdapters";

export const dynamic = "force-dynamic";

/** Probe llama.cpp's `/props` for the server's runtime context window.
 *  llama-server loads one model at one `-c N`, so this number is
 *  server-wide and applies to every entry in /v1/models. Unlike
 *  Ollama's per-model num_ctx, llama.cpp bakes the context at
 *  launch. Returns null if /props is unreachable or the shape is
 *  unexpected — we just won't show ctxMax in the UI for that server. */
async function fetchLlamaCppContext(base: string): Promise<number | null> {
  // /props is served at the root, not under /v1. Strip the /v1 suffix
  // we added when normalising.
  const root = base.replace(/\/v1$/, "");
  try {
    const r = await fetch(`${root}/props`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      default_generation_settings?: { n_ctx?: number };
      n_ctx?: number;
    };
    const n =
      j.default_generation_settings?.n_ctx ?? j.n_ctx ?? null;
    return typeof n === "number" && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Query a server that speaks the OpenAI /v1/models shape (llama.cpp,
 *  vLLM, etc.). Returns a flat list in Sahayak's `ModelInfo` shape.
 *  Most llama.cpp servers host exactly one model; we still return a
 *  list so the UI doesn't have to special-case the single-model case.
 *  Also probes /props for the server's n_ctx and applies it to every
 *  entry so the ContextPie + auto-compact both work without special
 *  casing the provider. */
async function fetchOpenAiModels(rawUrl: string) {
  const base = normalizeOpenAiBaseUrl(rawUrl);
  if (!base) {
    throw new Error(`invalid llama.cpp URL: ${rawUrl}`);
  }
  const [modelsRes, ctx] = await Promise.all([
    fetch(`${base}/models`, { headers: { accept: "application/json" } }),
    fetchLlamaCppContext(base),
  ]);
  if (!modelsRes.ok) {
    throw new Error(`${base}/models returned ${modelsRes.status}`);
  }
  const j = (await modelsRes.json()) as { data?: Array<{ id: string }> };
  const names = (j.data ?? []).map((m) => m.id).filter(Boolean);
  return names.map((name) => ({
    name,
    size: 0,
    family: "llama.cpp",
    quant: "",
    params: "",
    capabilities: [],
    contextLength: ctx,
  }));
}

/**
 * Parse a modelfile `PARAMETER num_ctx <N>` override from the raw
 * parameters blob returned by /api/show. Ollama treats this as the
 * ACTUAL runtime context window; it supersedes the base model's
 * declared context_length. Custom builds (e.g. qwen3.5:9b_128k baked
 * from a base that supports 256k) rely on this override.
 */
function parseNumCtx(parameters: string | undefined): number | null {
  if (!parameters) return null;
  const m = parameters.match(/^\s*num_ctx\s+(\d+)\s*$/m);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const llamaUrl = url.searchParams.get("url");
  if (llamaUrl) {
    try {
      const models = await fetchOpenAiModels(llamaUrl);
      return NextResponse.json({ models });
    } catch (e) {
      return NextResponse.json(
        { models: [], error: (e as Error).message },
        { status: 200 },
      );
    }
  }
  try {
    const models = await listModels();
    // Sahayak-derived models are internal plumbing used by
    // per-assistant context overrides; users shouldn't see them in
    // the picker.
    const userFacing = models.filter((m) => !isDerivedByUs(m.name));
    const enriched = await Promise.all(
      userFacing.map(async (m) => {
        try {
          const info = await showModel(m.name);
          const caps = info.capabilities ?? [];
          // Prefer the modelfile's num_ctx override — that's what
          // Ollama actually uses at runtime. Only fall back to the
          // base model's context_length when no override is set.
          const baseCtx =
            (info.model_info?.[
              `${info.model_info?.["general.architecture"]}.context_length`
            ] as number | undefined) ?? null;
          const overrideCtx = parseNumCtx(info.parameters);
          const ctx = overrideCtx ?? baseCtx;
          return {
            name: m.name,
            size: m.size,
            family: m.details?.family ?? "",
            quant: m.details?.quantization_level ?? "",
            params: m.details?.parameter_size ?? "",
            capabilities: caps,
            contextLength: ctx,
          };
        } catch {
          return {
            name: m.name,
            size: m.size,
            family: m.details?.family ?? "",
            quant: m.details?.quantization_level ?? "",
            params: m.details?.parameter_size ?? "",
            capabilities: [],
            contextLength: null,
          };
        }
      }),
    );
    // Sort: local models first, then :cloud models
    enriched.sort((a, b) => {
      const aCloud = a.name.endsWith(":cloud");
      const bCloud = b.name.endsWith(":cloud");
      if (aCloud !== bCloud) return aCloud ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    return NextResponse.json({ models: enriched });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

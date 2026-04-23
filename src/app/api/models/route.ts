import { NextResponse } from "next/server";
import { listModels, showModel } from "@/lib/ollama";

export const dynamic = "force-dynamic";

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

export async function GET() {
  try {
    const models = await listModels();
    const enriched = await Promise.all(
      models.map(async (m) => {
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

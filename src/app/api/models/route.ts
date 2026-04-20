import { NextResponse } from "next/server";
import { listModels, showModel } from "@/lib/ollama";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models = await listModels();
    const enriched = await Promise.all(
      models.map(async (m) => {
        try {
          const info = await showModel(m.name);
          const caps = info.capabilities ?? [];
          const ctx =
            (info.model_info?.[`${info.model_info?.["general.architecture"]}.context_length`] as number | undefined) ??
            null;
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

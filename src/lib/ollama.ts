export const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://localhost:11434";

export type OllamaModel = {
  name: string;
  model: string;
  size: number;
  details: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
};

export type OllamaShow = {
  capabilities: string[];
  model_info: Record<string, unknown>;
  parameters: string;
};

export async function listModels(): Promise<OllamaModel[]> {
  const r = await fetch(`${OLLAMA_URL}/api/tags`, { cache: "no-store" });
  if (!r.ok) throw new Error(`ollama /api/tags ${r.status}`);
  const j = (await r.json()) as { models: OllamaModel[] };
  return j.models ?? [];
}

export async function showModel(name: string): Promise<OllamaShow> {
  const r = await fetch(`${OLLAMA_URL}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`ollama /api/show ${r.status}`);
  return r.json();
}

/**
 * Deterministic name Sahayak uses for a model it derives from `base`
 * with a non-default `num_ctx`. Prefix keeps them namespaced so we can
 * hide them from the assistant editor's model list without tripping
 * user-named models that happen to use similar suffixes.
 */
export function derivedName(base: string, numCtx: number): string {
  const clean = base.replace(/^sahayak--?/, "");
  const safe = clean.replace(/[:/]/g, "_");
  return `sahayak--${safe}--ctx${numCtx}`;
}

/** True when the given model name is one Sahayak created. */
export function isDerivedByUs(name: string): boolean {
  return name.startsWith("sahayak--");
}

/**
 * Idempotently produces an Ollama model that's `base` with num_ctx
 * overridden to `numCtx`. Returns the model name to use in chat
 * requests. Reuses an existing derived model if one already exists.
 */
export async function deriveCtxModel(
  base: string,
  numCtx: number,
): Promise<string> {
  if (!Number.isFinite(numCtx) || numCtx <= 0) return base;
  const name = derivedName(base, numCtx);

  try {
    const existing = await listModels();
    if (existing.some((m) => m.name === name || m.model === name)) {
      return name;
    }
  } catch {
    // Listing failed — let /api/create surface the real error below.
  }

  const modelfile = `FROM ${base}\nPARAMETER num_ctx ${numCtx}\n`;
  const r = await fetch(`${OLLAMA_URL}/api/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name, modelfile, stream: false }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`ollama /api/create ${r.status}: ${text.slice(0, 200)}`);
  }
  return name;
}

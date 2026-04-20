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

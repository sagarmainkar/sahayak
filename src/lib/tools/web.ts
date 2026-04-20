import fs from "node:fs";
import path from "node:path";
import { err, ok, type ToolSpec } from "./types";

function getApiKey(): string | null {
  if (process.env.OLLAMA_API_KEY) return process.env.OLLAMA_API_KEY;
  try {
    const credFile = path.join(
      process.env.HOME ?? "",
      ".openclaw/credentials/ollama.json",
    );
    const raw = fs.readFileSync(credFile, "utf8");
    const j = JSON.parse(raw) as { api_key?: string };
    return j.api_key ?? null;
  } catch {
    return null;
  }
}

async function call(url: string, payload: unknown) {
  const key = getApiKey();
  if (!key) return err("missing_api_key", "OLLAMA_API_KEY not set");
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });
  if (r.status === 401) return err("unauthorized", "API key rejected");
  if (r.status === 429) return err("rate_limited", "too many requests");
  if (!r.ok) return err("upstream", `ollama ${r.status}`);
  return ok({ _raw: await r.json() });
}

export const webSearch: ToolSpec = {
  name: "web_search",
  group: "web",
  description: "Search the web via Ollama's hosted search (up to 10 results).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      max_results: { type: "integer" },
    },
    required: ["query"],
  },
  async handler(args) {
    const q = (args.query as string) ?? "";
    if (!q) return err("bad_args", "query required");
    const n = Math.max(1, Math.min(10, Number(args.max_results ?? 5)));
    const r = await call("https://ollama.com/api/web_search", {
      query: q,
      max_results: n,
    });
    if (!r.ok) return r;
    const results = ((r._raw as { results?: unknown[] })?.results ?? []) as unknown[];
    return ok({ query: q, results, total_results: results.length });
  },
};

export const webFetch: ToolSpec = {
  name: "web_fetch",
  group: "web",
  description: "Fetch a URL's readable content (title, text, up to 20 links).",
  parameters: {
    type: "object",
    properties: { url: { type: "string" } },
    required: ["url"],
  },
  async handler(args) {
    const url = (args.url as string) ?? "";
    if (!url) return err("bad_args", "url required");
    const r = await call("https://ollama.com/api/web_fetch", { url });
    if (!r.ok) return r;
    const data = (r._raw as Record<string, unknown>) ?? {};
    const content = String(data.content ?? "");
    const truncated = content.length > 256 * 1024;
    return ok({
      url,
      title: String(data.title ?? ""),
      content: truncated ? content.slice(0, 256 * 1024) : content,
      truncated,
      links: (data.links as unknown[] | undefined)?.slice(0, 20) ?? [],
    });
  },
};

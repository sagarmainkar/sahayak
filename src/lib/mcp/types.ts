export type McpTransport = "stdio" | "http";

export type McpServer = {
  id: string;
  /** Human-readable name — used as the prefix in exposed tool names,
   *  so keep it short and filesystem-safe (no colons/spaces). */
  name: string;
  /** How Sahayak reaches this server. Default "stdio" for back-compat
   *  with the earliest mcp.json entries that predate HTTP support. */
  transport?: McpTransport;
  // ── stdio ────────────────────────────────────────────────────────
  /** stdio spawn command. Required when transport === "stdio". */
  command?: string;
  args?: string[];
  /** Optional environment overrides spliced into the spawned process. */
  env?: Record<string, string>;
  // ── http (streamable HTTP / SSE) ─────────────────────────────────
  /** Full endpoint URL, required when transport === "http". Zapier's
   *  per-user URL looks like https://mcp.zapier.com/api/mcp/s/<id>/mcp. */
  url?: string;
  /** Custom headers to include on every HTTP request (e.g. `Authorization`
   *  for API-key servers). Zapier-style URLs carry auth in the path and
   *  need no headers; other hosts may require an Authorization header. */
  headers?: Record<string, string>;
  enabled: boolean;
  createdAt: number;
};

export type McpTool = {
  /** Prefixed name used by Sahayak: `mcp:<serverName>:<tool>`. Keeps
   *  it distinct from native tools and routable to the correct
   *  server. */
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      { type?: string; description?: string; enum?: unknown }
    >;
    required?: string[];
  };
  /** The server id that owns this tool (for routing). */
  serverId: string;
  /** The tool's native name on the server (without the mcp: prefix). */
  rawName: string;
};

export type McpServerStatus =
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "ready"; tools: number }
  | { kind: "error"; message: string };

export type McpServerSummary = {
  server: McpServer;
  status: McpServerStatus;
  tools: { name: string; description: string }[];
};

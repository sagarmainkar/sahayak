export type McpServer = {
  id: string;
  /** Human-readable name — used as the prefix in exposed tool names,
   *  so keep it short and filesystem-safe (no colons/spaces). */
  name: string;
  /** stdio spawn command + args. Transport is always stdio in v1. */
  command: string;
  args: string[];
  /** Optional environment overrides spliced into the spawned process. */
  env?: Record<string, string>;
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

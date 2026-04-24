export type ToolResult = {
  ok: boolean;
  [k: string]: unknown;
};

/** Request-scoped context passed to tool handlers that need to know
 *  which session they're operating under (currently: the artifact
 *  tools, which write into the session's `artifacts/` subtree). Most
 *  tools ignore it. Always set when invoked from the chat loop; may
 *  be absent in out-of-band invocations (tests, dev utilities). */
export type ToolContext = {
  assistantId: string;
  sessionId: string;
};

export type ToolSpec = {
  name: string;
  /** Native groups are a closed set; MCP tools carry "mcp:<serverName>"
   *  so the UI can bucket them alongside the native groups. */
  group: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      { type?: string; description?: string; enum?: unknown }
    >;
    required?: string[];
  };
  handler: (
    args: Record<string, unknown>,
    ctx?: ToolContext,
  ) => Promise<ToolResult>;
};

export function err(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): ToolResult {
  return { ok: false, error: code, message, ...extra };
}

export function ok(data: Record<string, unknown>): ToolResult {
  return { ok: true, ...data };
}

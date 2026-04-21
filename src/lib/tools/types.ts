export type ToolResult = {
  ok: boolean;
  [k: string]: unknown;
};

export type ToolSpec = {
  name: string;
  group: "fs" | "shell" | "web" | "gmail" | "memory";
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
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

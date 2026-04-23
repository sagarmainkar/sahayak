import type { ToolSpec } from "./types";
import {
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  getFileInfo,
  pathExists,
} from "./fs";
import { executeCommand } from "./shell";
import { webSearch, webFetch } from "./web";
import { gmailSearch, gmailHeaders, gmailBody, gmailThread } from "./gmail";
import { artifactCreate, artifactWriteFile } from "./artifact";
import { remember, recallMemory, listAllMemories } from "./memory";
import { callMcpTool, getAllMcpTools } from "@/lib/mcp/registry";

export const ALL_TOOLS: ToolSpec[] = [
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  getFileInfo,
  pathExists,
  executeCommand,
  webSearch,
  webFetch,
  gmailSearch,
  gmailHeaders,
  gmailBody,
  gmailThread,
  artifactCreate,
  artifactWriteFile,
  remember,
  recallMemory,
  listAllMemories,
];

export const TOOLS_BY_NAME = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);

/** Wrap an MCP tool discovery record into a Sahayak ToolSpec so both
 *  chat loops (native + pi) can treat it uniformly. The handler
 *  dispatches through the MCP client pool. */
function mcpToolAsSpec(t: {
  name: string;
  description: string;
  parameters: ToolSpec["parameters"];
}): ToolSpec {
  // name format: "mcp:<serverName>:<tool>" — carve the group out as
  // "mcp:<serverName>" so the UI can bucket all tools from one server.
  const parts = t.name.split(":");
  const group =
    parts.length >= 2 ? `mcp:${parts[1]}` : "mcp";
  return {
    name: t.name,
    group,
    description: t.description,
    parameters: t.parameters ?? { type: "object", properties: {} },
    handler: async (args) => {
      return await callMcpTool(t.name, args);
    },
  };
}

/** Resolve a tool by name. Returns null when nothing matches. Static
 *  tools are checked first; MCP tools are fetched on demand when the
 *  name has the `mcp:` prefix. */
export async function resolveTool(name: string): Promise<ToolSpec | null> {
  const staticHit = TOOLS_BY_NAME[name];
  if (staticHit) return staticHit;
  if (!name.startsWith("mcp:")) return null;
  try {
    const mcp = await getAllMcpTools();
    const hit = mcp.find((t) => t.name === name);
    if (!hit) return null;
    return mcpToolAsSpec(hit);
  } catch {
    return null;
  }
}

/** All tool specs currently available (static + live MCP). Async
 *  because MCP servers are stdio-spawned lazily. */
export async function allToolSpecs(): Promise<ToolSpec[]> {
  let mcp: ToolSpec[] = [];
  try {
    const discovered = await getAllMcpTools();
    mcp = discovered.map(mcpToolAsSpec);
  } catch {
    // A broken server shouldn't block native tool discovery.
  }
  return [...ALL_TOOLS, ...mcp];
}

export async function toolsForOllama(enabled: string[]) {
  const specs = await Promise.all(enabled.map((n) => resolveTool(n)));
  return specs
    .filter((t): t is ToolSpec => !!t)
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
}

export async function publicList() {
  const specs = await allToolSpecs();
  return specs.map((t) => ({
    name: t.name,
    group: t.group,
    description: t.description,
  }));
}

export type { ToolSpec };

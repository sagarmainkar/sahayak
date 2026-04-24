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
import { artifactCreate, artifactWriteFile } from "./artifact";
import { remember, recallMemory, listAllMemories } from "./memory";
import { gmailSearch, gmailRead } from "./gmail";
import { callMcpTool, getAllMcpTools } from "@/lib/mcp/registry";

/**
 * User-facing tools. Surfaced in the assistant editor's tool picker,
 * toggleable per-assistant, gated by HITL by default. `publicList()`
 * returns only these.
 */
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
  artifactCreate,
  artifactWriteFile,
  gmailSearch,
  gmailRead,
];

/**
 * Implicit tools — always available to the model, never shown in the
 * picker, never HITL-gated. Used for cross-session memory: the model
 * can stash facts/preferences/procedural notes and recall them on its
 * own without the user having to enable or approve each call. The
 * tool-call + tool-result still stream to the UI so the user can see
 * what got saved/recalled.
 */
const IMPLICIT_TOOLS: ToolSpec[] = [remember, recallMemory, listAllMemories];

/** Set for O(1) "is this an implicit tool?" checks in HITL gates. */
export const IMPLICIT_TOOL_NAMES = new Set(IMPLICIT_TOOLS.map((t) => t.name));

export const TOOLS_BY_NAME = Object.fromEntries(
  [...ALL_TOOLS, ...IMPLICIT_TOOLS].map((t) => [t.name, t]),
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

/** Merge caller's enabled list with implicit tools, dedup. */
function withImplicit(enabled: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of enabled) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  for (const t of IMPLICIT_TOOLS) {
    if (!seen.has(t.name)) {
      seen.add(t.name);
      out.push(t.name);
    }
  }
  return out;
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
  return [...ALL_TOOLS, ...IMPLICIT_TOOLS, ...mcp];
}

export async function toolsForOllama(enabled: string[]) {
  const names = withImplicit(enabled);
  const specs = await Promise.all(names.map((n) => resolveTool(n)));
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

/** The tool picker (assistant editor, settings UI) lists only
 *  user-facing + MCP-discovered tools. Implicit memory tools are
 *  deliberately hidden — they're always available regardless. */
export async function publicList() {
  let mcp: ToolSpec[] = [];
  try {
    const discovered = await getAllMcpTools();
    mcp = discovered.map(mcpToolAsSpec);
  } catch {}
  return [...ALL_TOOLS, ...mcp].map((t) => ({
    name: t.name,
    group: t.group,
    description: t.description,
  }));
}

/** Expose the implicit-merge helper to chat loops so they can build
 *  the `enabled` list with memory tools appended. */
export { withImplicit };

export type { ToolSpec };

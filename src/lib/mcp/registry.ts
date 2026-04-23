import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServer, McpServerStatus, McpTool } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const MCP_FILE = path.join(DATA_DIR, "mcp.json");

type PoolEntry = {
  client: Client | null;
  transport: Transport | null;
  status: McpServerStatus;
  tools: McpTool[];
  connectingPromise: Promise<void> | null;
};

/** Singleton pool kept on globalThis so Next dev-server hot-reloads
 *  don't orphan stdio child processes. */
const POOL_KEY = "__sahayakMcpPool";
type Pool = Map<string, PoolEntry>;
function getPool(): Pool {
  const g = globalThis as unknown as { [POOL_KEY]?: Pool };
  if (!g[POOL_KEY]) g[POOL_KEY] = new Map();
  return g[POOL_KEY]!;
}

async function loadServers(): Promise<McpServer[]> {
  if (!existsSync(MCP_FILE)) return [];
  try {
    const raw = await fs.readFile(MCP_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is McpServer => {
      if (!s || typeof s !== "object") return false;
      if (typeof s.id !== "string" || typeof s.name !== "string") return false;
      const transport = s.transport ?? "stdio";
      if (transport === "http") {
        return typeof s.url === "string" && s.url.length > 0;
      }
      // stdio default
      return typeof s.command === "string" && Array.isArray(s.args);
    });
  } catch {
    return [];
  }
}

async function saveServers(list: McpServer[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MCP_FILE, JSON.stringify(list, null, 2));
}

export async function listServers(): Promise<McpServer[]> {
  return loadServers();
}

export async function addServer(
  input:
    | {
        transport?: "stdio";
        name: string;
        command: string;
        args: string[];
        env?: Record<string, string>;
      }
    | {
        transport: "http";
        name: string;
        url: string;
        headers?: Record<string, string>;
      },
): Promise<McpServer> {
  const list = await loadServers();
  const clean = input.name.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32);
  if (!clean) throw new Error("name required");
  if (list.some((s) => s.name === clean)) {
    throw new Error(`server name '${clean}' already exists`);
  }
  const transport = input.transport ?? "stdio";
  const server: McpServer =
    transport === "http"
      ? {
          id: nanoid(12),
          name: clean,
          transport: "http",
          url: (input as { url: string }).url.trim(),
          headers: (input as { headers?: Record<string, string> }).headers,
          enabled: true,
          createdAt: Date.now(),
        }
      : {
          id: nanoid(12),
          name: clean,
          transport: "stdio",
          command: (input as { command: string }).command.trim(),
          args: (input as { args: string[] }).args,
          env: (input as { env?: Record<string, string> }).env,
          enabled: true,
          createdAt: Date.now(),
        };
  list.push(server);
  await saveServers(list);
  return server;
}

export async function removeServer(id: string): Promise<void> {
  const list = await loadServers();
  const next = list.filter((s) => s.id !== id);
  await saveServers(next);
  // Tear down any live connection.
  await disconnectOne(id);
}

export async function setServerEnabled(
  id: string,
  enabled: boolean,
): Promise<McpServer | null> {
  const list = await loadServers();
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  s.enabled = enabled;
  await saveServers(list);
  if (!enabled) await disconnectOne(id);
  return s;
}

async function disconnectOne(id: string): Promise<void> {
  const pool = getPool();
  const entry = pool.get(id);
  if (!entry) return;
  try {
    await entry.client?.close();
  } catch {}
  try {
    await entry.transport?.close();
  } catch {}
  pool.delete(id);
}

/** Spin up (or reuse) a connected client for this server. Returns the
 *  pool entry once it's ready — or throws if connect failed. */
async function connectOne(server: McpServer): Promise<PoolEntry> {
  const pool = getPool();
  const existing = pool.get(server.id);
  if (existing?.status.kind === "ready") return existing;
  if (existing?.connectingPromise) {
    await existing.connectingPromise;
    const latest = pool.get(server.id);
    if (latest && latest.status.kind === "ready") return latest;
    if (latest && latest.status.kind === "error") {
      throw new Error(latest.status.message);
    }
    return latest!;
  }

  const entry: PoolEntry = {
    client: null,
    transport: null,
    status: { kind: "connecting" },
    tools: [],
    connectingPromise: null,
  };
  pool.set(server.id, entry);

  entry.connectingPromise = (async () => {
    try {
      const transportKind = server.transport ?? "stdio";
      let transport: Transport;
      if (transportKind === "http") {
        if (!server.url) throw new Error("http transport: url required");
        transport = new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit:
            server.headers && Object.keys(server.headers).length
              ? { headers: server.headers }
              : undefined,
        });
      } else {
        if (!server.command) {
          throw new Error("stdio transport: command required");
        }
        transport = new StdioClientTransport({
          command: server.command,
          args: server.args ?? [],
          env: server.env
            ? { ...(process.env as Record<string, string>), ...server.env }
            : (process.env as Record<string, string>),
        });
      }
      const client = new Client(
        { name: "sahayak", version: "0.1.0" },
        { capabilities: {} },
      );
      await client.connect(transport);
      entry.client = client;
      entry.transport = transport;
      const res = await client.listTools();
      entry.tools = res.tools.map((t) => ({
        name: `mcp:${server.name}:${t.name}`,
        description: t.description ?? "",
        parameters: (t.inputSchema as McpTool["parameters"]) ?? {
          type: "object",
          properties: {},
        },
        serverId: server.id,
        rawName: t.name,
      }));
      entry.status = { kind: "ready", tools: entry.tools.length };
    } catch (e) {
      entry.status = {
        kind: "error",
        message: (e as Error).message ?? String(e),
      };
      try {
        await entry.client?.close();
      } catch {}
      try {
        await entry.transport?.close();
      } catch {}
      entry.client = null;
      entry.transport = null;
    } finally {
      entry.connectingPromise = null;
    }
  })();

  await entry.connectingPromise;
  if (entry.status.kind === "error") {
    throw new Error(entry.status.message);
  }
  return entry;
}

/** Lazily-connect then return all tools from all enabled servers.
 *  Errors from individual servers are swallowed so one bad server
 *  doesn't block discovery of others. */
export async function getAllMcpTools(): Promise<McpTool[]> {
  const list = await loadServers();
  const active = list.filter((s) => s.enabled);
  const results = await Promise.allSettled(
    active.map(async (s) => {
      const entry = await connectOne(s);
      return entry.tools;
    }),
  );
  const out: McpTool[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
  }
  return out;
}

export async function getStatus(
  id: string,
): Promise<{ status: McpServerStatus; tools: McpTool[] }> {
  const pool = getPool();
  const entry = pool.get(id);
  if (!entry) {
    return { status: { kind: "disconnected" }, tools: [] };
  }
  return { status: entry.status, tools: entry.tools };
}

/** Invoke a tool by its Sahayak-prefixed name. Connects the server on
 *  demand. The return value matches Sahayak's ToolResult shape
 *  (`{ok, ...}`) so it slots into the existing tool pipeline. */
export async function callMcpTool(
  prefixedName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; [k: string]: unknown }> {
  const match = prefixedName.match(/^mcp:([^:]+):(.+)$/);
  if (!match) {
    return { ok: false, error: "bad_name", message: `not an mcp tool: ${prefixedName}` };
  }
  const [, serverName, rawName] = match;
  const list = await loadServers();
  const server = list.find((s) => s.name === serverName);
  if (!server) {
    return { ok: false, error: "unknown_server", message: `server '${serverName}' not registered` };
  }
  if (!server.enabled) {
    return { ok: false, error: "server_disabled", message: `server '${serverName}' is disabled` };
  }
  let entry: PoolEntry;
  try {
    entry = await connectOne(server);
  } catch (e) {
    return { ok: false, error: "connect_failed", message: (e as Error).message };
  }
  if (!entry.client) {
    return { ok: false, error: "no_client", message: "mcp client not available" };
  }
  try {
    const res = await entry.client.callTool({
      name: rawName,
      arguments: args,
    });
    // MCP tool results: { content: [...], isError?: boolean }. Normalise
    // content to a string for the model; keep structured blocks in
    // `details` for UI.
    const content = Array.isArray(res.content) ? res.content : [];
    const text = content
      .filter((c): c is { type: "text"; text: string } => {
        return (
          !!c &&
          typeof c === "object" &&
          (c as { type?: unknown }).type === "text" &&
          typeof (c as { text?: unknown }).text === "string"
        );
      })
      .map((c) => c.text)
      .join("\n");
    const isError = res.isError === true;
    return {
      ok: !isError,
      text: text || undefined,
      ...(isError ? { error: "tool_error" } : {}),
      content,
    };
  } catch (e) {
    return { ok: false, error: "call_failed", message: (e as Error).message };
  }
}

/** Force-reconnect one server. Returns the fresh status. */
export async function reconnectServer(
  id: string,
): Promise<{ status: McpServerStatus; tools: McpTool[] }> {
  const list = await loadServers();
  const server = list.find((s) => s.id === id);
  if (!server) {
    return { status: { kind: "error", message: "not found" }, tools: [] };
  }
  await disconnectOne(id);
  try {
    const entry = await connectOne(server);
    return { status: entry.status, tools: entry.tools };
  } catch (e) {
    return {
      status: { kind: "error", message: (e as Error).message },
      tools: [],
    };
  }
}

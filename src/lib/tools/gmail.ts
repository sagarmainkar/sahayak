import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { err, ok, type ToolSpec } from "./types";

const pexec = promisify(execFile);

const AGENT_DIR = "/srv/work/agent-tools";
const PY = `${AGENT_DIR}/.venv/bin/python`;
const SCRIPT = `${AGENT_DIR}/gmail_agent.py`;

async function call(args: string[]) {
  try {
    const { stdout } = await pexec(PY, [SCRIPT, ...args, "--json"], {
      cwd: AGENT_DIR,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    try {
      return ok(JSON.parse(stdout));
    } catch {
      return err("bad_response", "non-JSON from gmail_agent", { stdout: stdout.slice(0, 500) });
    }
  } catch (e) {
    return err("gmail_failed", (e as Error).message);
  }
}

export const gmailSearch: ToolSpec = {
  name: "gmail_search",
  group: "gmail",
  description:
    "Search Gmail. Operators: from: to: subject: newer_than:7d older_than:1y after:YYYY/MM/DD has:attachment label:inbox is:unread.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      n: { type: "integer", description: "max results, default 10" },
    },
    required: ["query"],
  },
  handler: (args) =>
    call([
      "search",
      "-q",
      (args.query as string) ?? "",
      "-n",
      String(Math.max(1, Math.min(100, Number(args.n ?? 10)))),
    ]),
};

export const gmailHeaders: ToolSpec = {
  name: "gmail_headers",
  group: "gmail",
  description: "Headers (from/to/subject/date/message-id) for a Gmail message id.",
  parameters: {
    type: "object",
    properties: { message_id: { type: "string" } },
    required: ["message_id"],
  },
  handler: (args) => call(["headers", (args.message_id as string) ?? ""]),
};

export const gmailBody: ToolSpec = {
  name: "gmail_body",
  group: "gmail",
  description: "Plain-text body of a Gmail message (truncated to max_chars).",
  parameters: {
    type: "object",
    properties: {
      message_id: { type: "string" },
      max_chars: { type: "integer", description: "default 2000" },
    },
    required: ["message_id"],
  },
  handler: (args) =>
    call([
      "body",
      (args.message_id as string) ?? "",
      "--max-chars",
      String(Math.max(100, Math.min(20000, Number(args.max_chars ?? 2000)))),
    ]),
};

export const gmailThread: ToolSpec = {
  name: "gmail_thread",
  group: "gmail",
  description: "List messages in a Gmail thread.",
  parameters: {
    type: "object",
    properties: { thread_id: { type: "string" } },
    required: ["thread_id"],
  },
  handler: (args) => call(["thread", (args.thread_id as string) ?? ""]),
};

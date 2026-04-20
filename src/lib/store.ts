import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Assistant, ChatMessage, Session } from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const ASSISTANTS_FILE = path.join(DATA_DIR, "assistants.json");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful, concise assistant running locally on the user's machine.

Date awareness
- At the start of every new conversation, silently call execute_command with \`date -u '+%Y-%m-%d %H:%M UTC'\` to anchor time.
- Your training data is stale. For anything time-sensitive, prefer web_search over memory.

Style
- Direct and accurate. No filler.
- Match reply length to the task.
- Use markdown for code/lists; avoid when it doesn't help.

Reasoning (medium effort)
- Simple questions: answer directly.
- Multi-step: think briefly (2-4 sentences), then answer.
- Never dump long chain-of-thought.

Tools
- If a tool is enabled and relevant, call it instead of guessing.
- On tool errors, change arguments rather than retrying identically.

Safety
- Decline destructive shell actions unless explicitly asked.
- Never fabricate file paths, API responses, or command outputs.

Interactive artifacts (charts, dashboards, small apps)
- When the user asks for a visual, chart, or interactive widget, emit a
  fenced \`\`\`react-artifact block with a top comment providing:
    // title: <short title>
    // id: <kebab-case-slug>         (optional; UI will generate one otherwise)
  The code must define a single \`function App()\` component that is rendered
  automatically. React hooks are in scope (useState/useEffect/useMemo/useRef).
  Recharts is available via \`Recharts\` global. PapaParse via \`Papa\`.
- To include data: FIRST write the data file via write_file to the path
  \`data/artifacts/<same-id>/files/<filename>\` (use execute_command to fetch
  or compute if needed). THEN inside App(), fetch it via:
    const csv = await Sahayak.fetchData('<filename>');
  This is a sandbox-safe bridge; it calls the host and returns string or JSON.
- Keep artifacts self-contained: no external network calls from the React
  code. If you need web data, gather it with tools first, persist it via
  write_file, then fetch inside the artifact with Sahayak.fetchData.
- Example for a CSV chart:
    \`\`\`react-artifact
    // title: Example line chart
    // id: example-line
    function App() {
      const [rows, setRows] = useState([]);
      useEffect(() => {
        Sahayak.fetchData('data.csv').then(csv => {
          const parsed = Papa.parse(csv, { header: true, dynamicTyping: true });
          setRows(parsed.data);
        });
      }, []);
      const { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } = Recharts;
      return (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={rows}>
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="var(--accent, #b05830)" />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    \`\`\`
- After the artifact fence, add one short sentence describing it. The UI
  renders an inline card that opens the artifact in a side panel.`;

// ---------- assistants ----------

export async function readAssistants(): Promise<Assistant[]> {
  await ensureDirs();
  if (!existsSync(ASSISTANTS_FILE)) {
    await writeAssistants([]);
    return [];
  }
  const raw = await fs.readFile(ASSISTANTS_FILE, "utf8");
  try {
    const arr = JSON.parse(raw) as Assistant[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function writeAssistants(list: Assistant[]) {
  await ensureDirs();
  await fs.writeFile(ASSISTANTS_FILE, JSON.stringify(list, null, 2));
}

export async function seedIfEmpty() {
  const list = await readAssistants();
  if (list.length > 0) return;
  const now = Date.now();
  const a: Assistant = {
    id: nanoid(12),
    name: "Sahayak",
    emoji: "✨",
    color: "#6366f1",
    model: "qwen3.5:9b_128k",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    enabledTools: [],
    thinkMode: "medium",
    createdAt: now,
    updatedAt: now,
  };
  await writeAssistants([a]);
}

export async function listAssistants(): Promise<Assistant[]> {
  await seedIfEmpty();
  const list = await readAssistants();
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAssistant(id: string): Promise<Assistant | null> {
  const list = await readAssistants();
  return list.find((a) => a.id === id) ?? null;
}

export async function createAssistant(
  input: Partial<Assistant>,
): Promise<Assistant> {
  const list = await readAssistants();
  const now = Date.now();
  const a: Assistant = {
    id: nanoid(12),
    name: input.name ?? "Untitled",
    emoji: input.emoji ?? "✨",
    color: input.color ?? "#6366f1",
    model: input.model ?? "qwen3.5:9b_128k",
    systemPrompt: input.systemPrompt ?? "",
    enabledTools: input.enabledTools ?? [],
    thinkMode: input.thinkMode ?? "medium",
    createdAt: now,
    updatedAt: now,
  };
  await writeAssistants([...list, a]);
  await fs.mkdir(path.join(SESSIONS_DIR, a.id), { recursive: true });
  return a;
}

export async function updateAssistant(
  id: string,
  patch: Partial<Assistant>,
): Promise<Assistant | null> {
  const list = await readAssistants();
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  const updated: Assistant = {
    ...list[idx],
    ...patch,
    id: list[idx].id,
    createdAt: list[idx].createdAt,
    updatedAt: Date.now(),
  };
  list[idx] = updated;
  await writeAssistants(list);
  return updated;
}

export async function deleteAssistant(id: string) {
  const list = await readAssistants();
  await writeAssistants(list.filter((a) => a.id !== id));
  const dir = path.join(SESSIONS_DIR, id);
  if (existsSync(dir)) await fs.rm(dir, { recursive: true, force: true });
}

// ---------- sessions (JSONL) ----------

type MetaRecord = {
  type: "meta";
  id: string;
  assistantId: string;
  title: string;
  modelOverride: string | null;
  promptTokens: number;
  completionTokens: number;
  createdAt: number;
  updatedAt: number;
};

type MessageRecord = { type: "message"; data: ChatMessage };

function sessionPath(assistantId: string, id: string) {
  return path.join(SESSIONS_DIR, assistantId, `${id}.jsonl`);
}

function dumpSession(meta: MetaRecord, messages: ChatMessage[]): string {
  const lines: string[] = [JSON.stringify(meta)];
  for (const m of messages) {
    lines.push(JSON.stringify({ type: "message", data: m } satisfies MessageRecord));
  }
  return lines.join("\n") + "\n";
}

async function loadSessionFile(
  p: string,
): Promise<{ meta: MetaRecord; messages: ChatMessage[] } | null> {
  if (!existsSync(p)) return null;
  const raw = await fs.readFile(p, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  let meta: MetaRecord | null = null;
  const messages: ChatMessage[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "meta") meta = obj;
      else if (obj.type === "message") messages.push(obj.data);
    } catch {
      continue;
    }
  }
  if (!meta) return null;
  return { meta, messages };
}

function metaToSession(meta: MetaRecord, messages: ChatMessage[]): Session {
  return {
    id: meta.id,
    assistantId: meta.assistantId,
    title: meta.title,
    modelOverride: meta.modelOverride,
    messages,
    promptTokens: meta.promptTokens,
    completionTokens: meta.completionTokens,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

export async function listSessions(assistantId: string): Promise<Session[]> {
  const dir = path.join(SESSIONS_DIR, assistantId);
  if (!existsSync(dir)) return [];
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  const out: Session[] = [];
  for (const f of files) {
    const loaded = await loadSessionFile(path.join(dir, f));
    if (loaded) out.push(metaToSession(loaded.meta, loaded.messages));
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSession(id: string): Promise<Session | null> {
  // Walk all assistant dirs to find the session (id is global unique)
  if (!existsSync(SESSIONS_DIR)) return null;
  for (const aid of await fs.readdir(SESSIONS_DIR)) {
    const p = sessionPath(aid, id);
    if (existsSync(p)) {
      const loaded = await loadSessionFile(p);
      if (loaded) return metaToSession(loaded.meta, loaded.messages);
    }
  }
  return null;
}

export async function createSession(
  assistantId: string,
  input: { title?: string; messages?: ChatMessage[]; modelOverride?: string | null },
): Promise<Session> {
  const now = Date.now();
  const meta: MetaRecord = {
    type: "meta",
    id: nanoid(12),
    assistantId,
    title: input.title ?? "New chat",
    modelOverride: input.modelOverride ?? null,
    promptTokens: 0,
    completionTokens: 0,
    createdAt: now,
    updatedAt: now,
  };
  const messages = input.messages ?? [];
  const dir = path.join(SESSIONS_DIR, assistantId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(sessionPath(assistantId, meta.id), dumpSession(meta, messages));
  return metaToSession(meta, messages);
}

export async function updateSession(
  id: string,
  patch: {
    title?: string;
    messages?: ChatMessage[];
    modelOverride?: string | null;
    promptTokens?: number;
    completionTokens?: number;
  },
): Promise<Session | null> {
  if (!existsSync(SESSIONS_DIR)) return null;
  for (const aid of await fs.readdir(SESSIONS_DIR)) {
    const p = sessionPath(aid, id);
    if (!existsSync(p)) continue;
    const loaded = await loadSessionFile(p);
    if (!loaded) return null;
    const newMeta: MetaRecord = {
      ...loaded.meta,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.modelOverride !== undefined && { modelOverride: patch.modelOverride }),
      ...(patch.promptTokens !== undefined && { promptTokens: patch.promptTokens }),
      ...(patch.completionTokens !== undefined && {
        completionTokens: patch.completionTokens,
      }),
      updatedAt: Date.now(),
    };
    const newMessages = patch.messages ?? loaded.messages;
    await fs.writeFile(p, dumpSession(newMeta, newMessages));
    return metaToSession(newMeta, newMessages);
  }
  return null;
}

export async function deleteSession(id: string) {
  if (!existsSync(SESSIONS_DIR)) return;
  for (const aid of await fs.readdir(SESSIONS_DIR)) {
    const p = sessionPath(aid, id);
    if (existsSync(p)) {
      await fs.rm(p, { force: true });
      return;
    }
  }
}

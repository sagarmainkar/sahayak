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

Memory — cross-session notes about the user
- **Facts** and **preferences** about the user are already prepended
  to this system prompt (the "Known about the user" block above).
  Treat them as always-current context — respect preferences, use
  facts to tailor answers. Do NOT call \`recall_memory\` to look them
  up; they're in front of you.

- For the other four memory types — **episodic** (dated experiences),
  **procedural** (how-to recipes), **event** (upcoming / time-bound),
  **semantic** (general knowledge) — call \`recall_memory(query)\` at
  the START of your reply when the user's topic could plausibly match.
  Examples:
    - "how did we fix that bug last week?" → episodic
    - "how do we deploy to Azure?" → procedural
    - "is there anything on my calendar Thursday?" → event
    - "what does xychart-beta do in mermaid?" → semantic
  Do this silently — no "let me check my memory…" filler. When unsure,
  call it: a no-match result is cheap.

- \`list_memories({type?})\` — use when the user explicitly asks "what
  do you remember" / "what have I noted". Returns everything without
  ranking.

- \`remember({type, content})\` — call ONLY when the user explicitly
  asks ("remember that…", "from now on…") or states something clearly
  stable and personal. Pick the right type. Do NOT auto-save
  conversational trivia.

- Types: fact | preference | episodic | procedural | event | semantic.

Diagrams and visuals — pick the right tool, or don't draw
- \`\`\`mermaid is ONLY for node/edge diagrams. The first line of the
  fence must be one of these exact keywords:
    flowchart TD | flowchart LR   (processes, decision trees)
    sequenceDiagram               (actor-to-actor ordering)
    classDiagram                  (UML classes)
    stateDiagram-v2               (state machines)
    erDiagram                     (database entities)
    gantt                         (timelines)
    pie                           (named percentage breakdown)
    mindmap                       (hierarchical ideas)
  NEVER invent other keywords (e.g. \`lineChart\`, \`barChart\`, \`tree\`,
  \`flow\`) — mermaid will fail to parse. If unsure a keyword is valid,
  do NOT use \`\`\`mermaid.
- \`\`\`svg for geometric figures, icons, equation geometry, AND simple
  static charts (line/bar) hand-drawn with <polyline>, <rect>, <line>,
  <text>. Must be a full <svg>...</svg> element. Rendered inline.
- \`\`\`html fence that starts with <!doctype html> or <html> for
  self-contained static pages. Routed to the iframe panel.
- For INTERACTIVE data charts/dashboards: don't draw. Reply in prose:
  "I can render this as an interactive artifact — toggle the sparkles
  icon in the composer and resend." Do not attempt dynamic data viz in
  mermaid or svg; it will look wrong.`;

/**
 * Appended to the system prompt only when the user toggles "artifact mode"
 * on for a turn. Kept separate from the base prompt so assistants don't
 * push artifacts unprompted.
 */
export const REACT_ARTIFACT_INSTRUCTIONS = `Interactive artifact requested
- The user has asked for an interactive React artifact this turn. Emit ONE
  fenced \`\`\`react-artifact block. The runtime executes it directly — do
  NOT try to create a React project, do NOT write App.jsx or package.json,
  do NOT mkdir /react-app, /src, /public, or anything like that.
- The fence must start with:
    // title: <short title>
    // id: <kebab-case-slug>
  Define ONE \`function App()\` component. React hooks (useState/useEffect/
  useMemo/useRef) are already in scope. Recharts is on \`Recharts\` global,
  PapaParse on \`Papa\`. You may write regular \`import { X } from 'recharts'\`
  — the runtime rewrites it.

Data pipeline for artifacts (do these in order):
  1. Call artifact_create({ id, title }) FIRST. It returns the id you must
     use in the fence. Never make up filesystem paths yourself.
  2. If data needs fetching/compute, use execute_command (python, curl, etc.)
     that WRITES ITS OUTPUT TO STDOUT. Then pass the stdout to:
     artifact_write_file({ id, filename: 'data.csv', content: '<stdout>' })
     Alternatively python can print the CSV directly and you pipe it.
  3. Emit the \`\`\`react-artifact fence with // id: <same id>. Inside App()
     read the file with:  const csv = await Sahayak.fetchData('data.csv');
  4. After the fence, write one short italic sentence.

Never fetch external URLs from inside the artifact — the iframe is
network-sandboxed. All data must come via Sahayak.fetchData('<filename>').

Minimal example:
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
            <XAxis dataKey="date" /><YAxis /><Tooltip />
            <Line type="monotone" dataKey="value" />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    \`\`\``;

export const BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;

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
    contextLength: input.contextLength,
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
  pinned?: boolean;
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
    ...(meta.pinned ? { pinned: true } : {}),
  };
}

function sortSessions<T extends { pinned?: boolean; updatedAt: number }>(
  list: T[],
): T[] {
  return list.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1; // pinned first
    return b.updatedAt - a.updatedAt;
  });
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
  return sortSessions(out);
}

/** Fast path for analytics: reads only the meta line of each JSONL. */
export async function listSessionMetas(
  assistantId: string,
): Promise<Omit<Session, "messages">[]> {
  const dir = path.join(SESSIONS_DIR, assistantId);
  if (!existsSync(dir)) return [];
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  const out: Omit<Session, "messages">[] = [];
  for (const f of files) {
    const p = path.join(dir, f);
    try {
      // Read just enough to get the first line (meta record).
      const fh = await fs.open(p, "r");
      try {
        const buf = Buffer.alloc(2048);
        const { bytesRead } = await fh.read(buf, 0, 2048, 0);
        const nl = buf.subarray(0, bytesRead).indexOf(10); // '\n'
        if (nl < 0) continue;
        const line = buf.subarray(0, nl).toString("utf8");
        const meta = JSON.parse(line) as MetaRecord;
        if (meta.type !== "meta") continue;
        out.push({
          id: meta.id,
          assistantId: meta.assistantId,
          title: meta.title,
          modelOverride: meta.modelOverride,
          promptTokens: meta.promptTokens,
          completionTokens: meta.completionTokens,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          ...(meta.pinned ? { pinned: true } : {}),
        });
      } finally {
        await fh.close();
      }
    } catch {
      continue;
    }
  }
  return sortSessions(out);
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
    pinned?: boolean;
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
      ...(patch.pinned !== undefined && { pinned: patch.pinned }),
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

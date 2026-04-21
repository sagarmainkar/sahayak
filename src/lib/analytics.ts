import type { Assistant } from "@/lib/types";
import { listAssistants, listSessionMetas } from "@/lib/store";

export type AssistantStats = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  model: string;
  chats: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  lastActiveAt: number | null;
};

export type ModelStats = {
  name: string;
  isCloud: boolean;
  assistants: string[]; // names
  chats: number;
  totalTokens: number;
};

export type DayBucket = {
  date: string; // YYYY-MM-DD
  byAssistant: Record<string, number>;
  total: number;
};

export type GlobalStats = {
  assistants: AssistantStats[];
  models: ModelStats[];
  days: DayBucket[]; // last 14
  totals: {
    assistants: number;
    chats: number;
    tokens: number;
  };
};

function dayKey(ms: number) {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function last14Days(now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = 13; i >= 0; i--) {
    out.push(dayKey(now - i * 86400 * 1000));
  }
  return out;
}

export async function computeGlobalStats(): Promise<GlobalStats> {
  const assistants = await listAssistants();
  const aById: Record<string, Assistant> = {};
  for (const a of assistants) aById[a.id] = a;

  // One meta line per session. Cheap.
  const allSessions: Array<Awaited<ReturnType<typeof listSessionMetas>>[number]> = [];
  for (const a of assistants) {
    const metas = await listSessionMetas(a.id);
    for (const s of metas) allSessions.push(s);
  }

  const perAssistant: Record<string, AssistantStats> = {};
  for (const a of assistants) {
    perAssistant[a.id] = {
      id: a.id,
      name: a.name,
      emoji: a.emoji,
      color: a.color,
      model: a.model,
      chats: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      lastActiveAt: null,
    };
  }
  for (const s of allSessions) {
    const bucket = perAssistant[s.assistantId];
    if (!bucket) continue;
    bucket.chats += 1;
    bucket.promptTokens += s.promptTokens ?? 0;
    bucket.completionTokens += s.completionTokens ?? 0;
    bucket.totalTokens += (s.promptTokens ?? 0) + (s.completionTokens ?? 0);
    if (!bucket.lastActiveAt || s.updatedAt > bucket.lastActiveAt) {
      bucket.lastActiveAt = s.updatedAt;
    }
  }

  const perModel: Record<string, ModelStats> = {};
  for (const s of allSessions) {
    const a = aById[s.assistantId];
    const modelName = s.modelOverride ?? a?.model ?? "unknown";
    if (!perModel[modelName]) {
      perModel[modelName] = {
        name: modelName,
        isCloud: modelName.endsWith(":cloud"),
        assistants: [],
        chats: 0,
        totalTokens: 0,
      };
    }
    const m = perModel[modelName];
    m.chats += 1;
    m.totalTokens += (s.promptTokens ?? 0) + (s.completionTokens ?? 0);
    if (a && !m.assistants.includes(a.name)) m.assistants.push(a.name);
  }

  const days = last14Days();
  const daySet = new Set(days);
  const byDay: Record<string, DayBucket> = {};
  for (const k of days) {
    byDay[k] = { date: k, byAssistant: {}, total: 0 };
  }
  for (const s of allSessions) {
    const k = dayKey(s.updatedAt);
    if (!daySet.has(k)) continue;
    const tokens = (s.promptTokens ?? 0) + (s.completionTokens ?? 0);
    if (!tokens) continue;
    const a = aById[s.assistantId];
    const label = a?.name ?? "unknown";
    const b = byDay[k];
    b.byAssistant[label] = (b.byAssistant[label] ?? 0) + tokens;
    b.total += tokens;
  }

  const assistantsOut = Object.values(perAssistant).sort(
    (a, b) => b.totalTokens - a.totalTokens,
  );
  const modelsOut = Object.values(perModel).sort(
    (a, b) => b.totalTokens - a.totalTokens,
  );

  return {
    assistants: assistantsOut,
    models: modelsOut,
    days: Object.values(byDay),
    totals: {
      assistants: assistants.length,
      chats: allSessions.length,
      tokens: assistantsOut.reduce((s, a) => s + a.totalTokens, 0),
    },
  };
}

export async function computeAssistantStats(
  id: string,
): Promise<AssistantStats | null> {
  const g = await computeGlobalStats();
  return g.assistants.find((a) => a.id === id) ?? null;
}

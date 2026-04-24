import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { SETTINGS_FILE } from "@/lib/paths";

export type TtsBackend = "soprano" | "polly";

export type Settings = {
  tts: {
    backend: TtsBackend;
    pollyVoice: string | null;
  };
  cleanup: {
    /** Age (in days) after which non-pinned sessions/artifacts are swept. */
    ttlDays: number;
  };
  ollama: {
    /** Bearer token for ollama.com's hosted web_search / web_fetch.
     *  Empty string = disabled; the tools return a friendly error. */
    apiKey: string;
  };
};

const DEFAULT_TTL_DAYS = 15;
const MIN_TTL_DAYS = 1;
const MAX_TTL_DAYS = 365;

const DEFAULTS: Settings = {
  tts: {
    backend: "soprano",
    pollyVoice: null,
  },
  cleanup: {
    ttlDays: DEFAULT_TTL_DAYS,
  },
  ollama: {
    apiKey: "",
  },
};

function clampTtl(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_TTL_DAYS;
  return Math.max(MIN_TTL_DAYS, Math.min(MAX_TTL_DAYS, v));
}

export async function readSettings(): Promise<Settings> {
  if (!existsSync(SETTINGS_FILE)) return DEFAULTS;
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      tts: {
        backend:
          parsed.tts?.backend === "polly" ? "polly" : DEFAULTS.tts.backend,
        pollyVoice:
          typeof parsed.tts?.pollyVoice === "string"
            ? parsed.tts.pollyVoice
            : DEFAULTS.tts.pollyVoice,
      },
      cleanup: {
        ttlDays:
          parsed.cleanup?.ttlDays !== undefined
            ? clampTtl(parsed.cleanup.ttlDays)
            : DEFAULTS.cleanup.ttlDays,
      },
      ollama: {
        apiKey:
          typeof parsed.ollama?.apiKey === "string"
            ? parsed.ollama.apiKey.trim()
            : DEFAULTS.ollama.apiKey,
      },
    };
  } catch {
    return DEFAULTS;
  }
}

export type SettingsPatch = {
  tts?: {
    backend?: TtsBackend;
    pollyVoice?: string | null;
  };
  cleanup?: {
    ttlDays?: number;
  };
  ollama?: {
    apiKey?: string;
  };
};

export async function writeSettings(patch: SettingsPatch): Promise<Settings> {
  const cur = await readSettings();
  const next: Settings = {
    tts: {
      backend: patch.tts?.backend ?? cur.tts.backend,
      pollyVoice:
        patch.tts?.pollyVoice !== undefined
          ? patch.tts.pollyVoice
          : cur.tts.pollyVoice,
    },
    cleanup: {
      ttlDays:
        patch.cleanup?.ttlDays !== undefined
          ? clampTtl(patch.cleanup.ttlDays)
          : cur.cleanup.ttlDays,
    },
    ollama: {
      apiKey:
        typeof patch.ollama?.apiKey === "string"
          ? patch.ollama.apiKey.trim()
          : cur.ollama.apiKey,
    },
  };
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

export const CLEANUP_TTL_BOUNDS = {
  min: MIN_TTL_DAYS,
  max: MAX_TTL_DAYS,
  default: DEFAULT_TTL_DAYS,
};

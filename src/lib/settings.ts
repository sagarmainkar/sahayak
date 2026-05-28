import type { SavedPrompt } from "@/lib/types";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { SETTINGS_FILE } from "@/lib/paths";

export type TtsBackend = "soprano" | "polly";

export type LlamaDefaults = {
  contextSize: number;
  kvType: "f16" | "q8_0" | "q4_0";
  port: number;
  ngl: number;
  flashAttn: boolean;
  jinja: boolean;
  noContextShift: boolean;
};

export type BedrockModelEntry = {
  id: string;
  name: string;
  contextLength?: number;
};

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
  llamaServer: {
    /** Absolute path to the llama-server binary. Empty = auto-detect
     *  at ~/.unsloth/llama.cpp/llama-server */
    path: string;
    defaults: LlamaDefaults;
  };
  bedrock: {
    region: string;
    models: BedrockModelEntry[];
  };
  prompts: SavedPrompt[];
};

const DEFAULT_TTL_DAYS = 15;
const MIN_TTL_DAYS = 1;
const MAX_TTL_DAYS = 365;

const DEFAULT_LLAMA_PATH = path.join(
  homedir(),
  ".unsloth",
  "llama.cpp",
  "llama-server",
);

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
  llamaServer: {
    path: DEFAULT_LLAMA_PATH,
    defaults: {
      contextSize: 32768,
      kvType: "q8_0",
      port: 8080,
      ngl: 999,
      flashAttn: true,
      jinja: true,
      noContextShift: true,
    },
  },
  bedrock: {
    region: "",
    models: [],
  },
  prompts: [],
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
      llamaServer: {
        path:
          typeof parsed.llamaServer?.path === "string"
            ? parsed.llamaServer.path.trim()
            : DEFAULTS.llamaServer.path,
        defaults: {
          contextSize:
            typeof parsed.llamaServer?.defaults?.contextSize === "number"
              ? parsed.llamaServer.defaults.contextSize
              : DEFAULTS.llamaServer.defaults.contextSize,
          kvType: ["f16", "q8_0", "q4_0"].includes(
            parsed.llamaServer?.defaults?.kvType as string,
          )
            ? (parsed.llamaServer?.defaults?.kvType as "f16" | "q8_0" | "q4_0")
            : DEFAULTS.llamaServer.defaults.kvType,
          port:
            typeof parsed.llamaServer?.defaults?.port === "number"
              ? parsed.llamaServer.defaults.port
              : DEFAULTS.llamaServer.defaults.port,
          ngl:
            typeof parsed.llamaServer?.defaults?.ngl === "number"
              ? parsed.llamaServer.defaults.ngl
              : DEFAULTS.llamaServer.defaults.ngl,
          flashAttn:
            typeof parsed.llamaServer?.defaults?.flashAttn === "boolean"
              ? parsed.llamaServer.defaults.flashAttn
              : DEFAULTS.llamaServer.defaults.flashAttn,
          jinja:
            typeof parsed.llamaServer?.defaults?.jinja === "boolean"
              ? parsed.llamaServer.defaults.jinja
              : DEFAULTS.llamaServer.defaults.jinja,
          noContextShift:
            typeof parsed.llamaServer?.defaults?.noContextShift === "boolean"
              ? parsed.llamaServer.defaults.noContextShift
              : DEFAULTS.llamaServer.defaults.noContextShift,
        },
      },
      bedrock: {
        region:
          typeof parsed.bedrock?.region === "string"
            ? parsed.bedrock.region.trim()
            : DEFAULTS.bedrock.region,
        models: Array.isArray(parsed.bedrock?.models)
          ? parsed.bedrock.models.filter(
              (m): m is BedrockModelEntry =>
                typeof m === "object" &&
                m !== null &&
                typeof (m as BedrockModelEntry).id === "string" &&
                typeof (m as BedrockModelEntry).name === "string",
            )
          : DEFAULTS.bedrock.models,
      },
      prompts: Array.isArray(parsed.prompts) ? parsed.prompts : DEFAULTS.prompts,
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
  llamaServer?: {
    path?: string;
    defaults?: Partial<LlamaDefaults>;
  };
  bedrock?: {
    region?: string;
    models?: BedrockModelEntry[];
  };
  prompts?: SavedPrompt[];
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
    llamaServer: {
      path:
        typeof patch.llamaServer?.path === "string"
          ? patch.llamaServer.path.trim()
          : cur.llamaServer.path,
      defaults: {
        contextSize:
          patch.llamaServer?.defaults?.contextSize ?? cur.llamaServer.defaults.contextSize,
        kvType: patch.llamaServer?.defaults?.kvType ?? cur.llamaServer.defaults.kvType,
        port: patch.llamaServer?.defaults?.port ?? cur.llamaServer.defaults.port,
        ngl: patch.llamaServer?.defaults?.ngl ?? cur.llamaServer.defaults.ngl,
        flashAttn: patch.llamaServer?.defaults?.flashAttn ?? cur.llamaServer.defaults.flashAttn,
        jinja: patch.llamaServer?.defaults?.jinja ?? cur.llamaServer.defaults.jinja,
        noContextShift:
          patch.llamaServer?.defaults?.noContextShift ?? cur.llamaServer.defaults.noContextShift,
      },
    },
    bedrock: {
      region:
        typeof patch.bedrock?.region === "string"
          ? patch.bedrock.region.trim()
          : cur.bedrock.region,
      models: patch.bedrock?.models ?? cur.bedrock.models,
    },
    prompts: patch.prompts ?? cur.prompts,
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

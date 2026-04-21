import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SETTINGS_FILE = path.join(process.cwd(), "data", "settings.json");

export type TtsBackend = "soprano" | "polly";

export type Settings = {
  tts: {
    backend: TtsBackend;
    pollyVoice: string | null;
  };
};

const DEFAULTS: Settings = {
  tts: {
    backend: "soprano",
    pollyVoice: null,
  },
};

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
  };
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

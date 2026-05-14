import { NextResponse } from "next/server";
import {
  readSettings,
  writeSettings,
  type SettingsPatch,
  type TtsBackend,
} from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const settings = await readSettings();
  return NextResponse.json({ settings });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const backend: TtsBackend | undefined =
    body?.tts?.backend === "polly" || body?.tts?.backend === "soprano"
      ? body.tts.backend
      : undefined;
  const voice: string | null | undefined =
    body?.tts?.pollyVoice === null ||
    typeof body?.tts?.pollyVoice === "string"
      ? body.tts.pollyVoice
      : undefined;

  const ttlDays: number | undefined =
    typeof body?.cleanup?.ttlDays === "number"
      ? body.cleanup.ttlDays
      : undefined;

  const apiKey: string | undefined =
    typeof body?.ollama?.apiKey === "string"
      ? body.ollama.apiKey
      : undefined;

  const llamaPath: string | undefined =
    typeof body?.llamaServer?.path === "string"
      ? body.llamaServer.path
      : undefined;

  const patch: SettingsPatch = {};
  if (backend !== undefined || voice !== undefined) {
    patch.tts = {};
    if (backend !== undefined) patch.tts.backend = backend;
    if (voice !== undefined) patch.tts.pollyVoice = voice;
  }
  if (ttlDays !== undefined) {
    patch.cleanup = { ttlDays };
  }
  if (apiKey !== undefined) {
    patch.ollama = { apiKey };
  }
  if (llamaPath !== undefined || body?.llamaServer?.defaults !== undefined) {
    patch.llamaServer = {};
    if (llamaPath !== undefined) patch.llamaServer.path = llamaPath;
    if (body?.llamaServer?.defaults !== undefined) {
      patch.llamaServer.defaults = {};
      const d = body.llamaServer.defaults;
      if (typeof d.contextSize === "number")
        patch.llamaServer.defaults.contextSize = d.contextSize;
      if (["f16", "q8_0", "q4_0"].includes(d.kvType))
        patch.llamaServer.defaults.kvType = d.kvType;
      if (typeof d.port === "number") patch.llamaServer.defaults.port = d.port;
      if (typeof d.ngl === "number") patch.llamaServer.defaults.ngl = d.ngl;
      if (typeof d.flashAttn === "boolean")
        patch.llamaServer.defaults.flashAttn = d.flashAttn;
      if (typeof d.jinja === "boolean")
        patch.llamaServer.defaults.jinja = d.jinja;
      if (typeof d.noContextShift === "boolean")
        patch.llamaServer.defaults.noContextShift = d.noContextShift;
    }
  }
  if (Array.isArray(body?.prompts)) {
    patch.prompts = body.prompts;
  }
  const settings = await writeSettings(patch);
  return NextResponse.json({ settings });
}

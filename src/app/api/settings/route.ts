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

  const patch: SettingsPatch = {};
  if (backend !== undefined || voice !== undefined) {
    patch.tts = {};
    if (backend !== undefined) patch.tts.backend = backend;
    if (voice !== undefined) patch.tts.pollyVoice = voice;
  }
  if (ttlDays !== undefined) {
    patch.cleanup = { ttlDays };
  }
  const settings = await writeSettings(patch);
  return NextResponse.json({ settings });
}

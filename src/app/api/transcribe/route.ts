import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { transcribeWithDaemon } from "@/lib/whisperDaemon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "audio required" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  // Preserve extension so ffmpeg (via av in faster-whisper) can demux.
  const ext = (file.name.match(/\.(webm|ogg|wav|mp3|m4a|mp4)$/i)?.[1] ?? "webm").toLowerCase();
  const tmp = path.join(tmpdir(), `sahayak-${randomBytes(6).toString("hex")}.${ext}`);
  await fs.writeFile(tmp, bytes);
  try {
    const text = await transcribeWithDaemon(tmp);
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  } finally {
    fs.rm(tmp, { force: true }).catch(() => {});
  }
}

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function runPolly(text: string, voice: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Neural voices support the most languages; some voices only support
    // "standard" or "generative" — we default to neural and let Polly error
    // clearly if the voice isn't supported.
    const args = [
      "polly",
      "synthesize-speech",
      "--engine",
      "neural",
      "--output-format",
      "mp3",
      "--voice-id",
      voice,
      "--text",
      text,
      outPath,
    ];
    const child = spawn("aws", args);
    const errBuf: Buffer[] = [];
    child.stderr.on("data", (d: Buffer) => errBuf.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `aws polly exit ${code}: ${Buffer.concat(errBuf).toString("utf8")}`,
          ),
        );
    });
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { text?: string; voice?: string };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voice = typeof body.voice === "string" ? body.voice.trim() : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (!voice)
    return NextResponse.json({ error: "voice required" }, { status: 400 });
  const out = path.join(
    tmpdir(),
    `sahayak-tts-${randomBytes(6).toString("hex")}.mp3`,
  );
  try {
    await runPolly(text, voice, out);
    const mp3 = await fs.readFile(out);
    return new Response(new Uint8Array(mp3), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(mp3.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  } finally {
    fs.rm(out, { force: true }).catch(() => {});
  }
}

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PY = "/srv/work/agent-tools/.venv/bin/python3";
const SCRIPT = path.join(process.cwd(), "python", "speak_soprano.py");

function runSynth(text: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(PY, [SCRIPT, outPath]);
    const errBuf: Buffer[] = [];
    child.stderr.on("data", (d: Buffer) => errBuf.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `soprano exit ${code}: ${Buffer.concat(errBuf).toString("utf8")}`,
          ),
        );
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { text?: string };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const out = path.join(tmpdir(), `sahayak-tts-${randomBytes(6).toString("hex")}.wav`);
  try {
    await runSynth(text, out);
    const wav = await fs.readFile(out);
    return new Response(new Uint8Array(wav), {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wav.length),
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

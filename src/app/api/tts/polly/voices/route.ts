import { NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PollyVoice = {
  Id: string;
  Name: string;
  Gender: "Male" | "Female";
  LanguageCode: string;
  LanguageName: string;
  SupportedEngines: string[];
};

function listVoices(): Promise<PollyVoice[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("aws", [
      "polly",
      "describe-voices",
      "--engine",
      "neural",
      "--output",
      "json",
    ]);
    const out: Buffer[] = [];
    const errBuf: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => errBuf.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `aws polly describe-voices exit ${code}: ${Buffer.concat(errBuf).toString("utf8")}`,
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(out).toString("utf8")) as {
          Voices: PollyVoice[];
        };
        resolve(parsed.Voices ?? []);
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function GET() {
  try {
    const voices = await listVoices();
    voices.sort((a, b) => {
      if (a.LanguageCode !== b.LanguageCode) {
        return a.LanguageCode.localeCompare(b.LanguageCode);
      }
      return a.Name.localeCompare(b.Name);
    });
    return NextResponse.json({ voices });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

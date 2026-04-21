import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PY = "/srv/work/agent-tools/.venv/bin/python3";
const SCRIPT = path.join(process.cwd(), "python", "transcribe_daemon.py");

type Pending = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
};

let daemon: ChildProcessWithoutNullStreams | null = null;
let readyPromise: Promise<void> | null = null;
const pending = new Map<string, Pending>();
let stdoutBuf = "";

function spawnDaemon(): Promise<void> {
  const child = spawn(PY, [SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
  daemon = child;

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    let gotReady = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: { id?: string; text?: string; error?: string; ready?: boolean };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.ready) {
          gotReady = true;
          resolveReady();
          continue;
        }
        if (!msg.id) continue;
        const p = pending.get(msg.id);
        if (!p) continue;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.text ?? "");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      // Surface daemon diagnostic output in dev logs but don't fail on them.
      process.stderr.write(`[whisper] ${chunk.toString("utf8")}`);
    });

    child.on("exit", (code) => {
      daemon = null;
      readyPromise = null;
      stdoutBuf = "";
      if (!gotReady) rejectReady(new Error(`whisper daemon exited before ready (code ${code})`));
      for (const p of pending.values()) {
        p.reject(new Error(`whisper daemon exited (code ${code})`));
      }
      pending.clear();
    });

    child.on("error", (err) => {
      daemon = null;
      readyPromise = null;
      if (!gotReady) rejectReady(err);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    });
  });

  return ready;
}

async function ensureReady(): Promise<void> {
  if (daemon && readyPromise) {
    await readyPromise;
    return;
  }
  readyPromise = spawnDaemon();
  await readyPromise;
}

export async function transcribeWithDaemon(audioPath: string): Promise<string> {
  await ensureReady();
  if (!daemon) throw new Error("whisper daemon unavailable");
  const id = randomUUID();
  const p = new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  daemon.stdin.write(JSON.stringify({ id, path: audioPath }) + "\n");
  return p;
}

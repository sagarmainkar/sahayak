import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { err, ok, type ToolSpec } from "./types";

const pexec = promisify(execFile);

export const executeCommand: ToolSpec = {
  name: "execute_command",
  group: "shell",
  description: "Run a shell command. Returns exit code, stdout, stderr.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      working_directory: { type: "string" },
      timeout: { type: "integer", description: "seconds, default 60, max 120" },
    },
    required: ["command"],
  },
  async handler(args) {
    try {
      const cmd = args.command as string;
      if (!cmd || typeof cmd !== "string")
        return err("bad_args", "command required");
      const timeout =
        Math.max(1, Math.min(120, Number(args.timeout ?? 60))) * 1000;
      const cwd = (args.working_directory as string) || undefined;
      try {
        const { stdout, stderr } = await pexec("bash", ["-lc", cmd], {
          cwd,
          timeout,
          maxBuffer: 1024 * 1024,
        });
        return {
          ok: true,
          command: cmd,
          cwd: cwd ?? process.cwd(),
          exit_code: 0,
          stdout: stdout.slice(0, 256 * 1024),
          stderr: stderr.slice(0, 256 * 1024),
        };
      } catch (e) {
        const ex = e as { code?: number; killed?: boolean; stdout?: string; stderr?: string; message?: string };
        return {
          ok: false,
          error: ex.killed ? "timeout" : "non_zero_exit",
          command: cmd,
          exit_code: ex.code ?? -1,
          stdout: (ex.stdout ?? "").slice(0, 256 * 1024),
          stderr: (ex.stderr ?? ex.message ?? "").slice(0, 256 * 1024),
        };
      }
    } catch (e) {
      return err("internal", (e as Error).message);
    }
  },
};

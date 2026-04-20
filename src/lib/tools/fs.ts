import fs from "node:fs/promises";
import { Stats } from "node:fs";
import path from "node:path";
import { err, ok, type ToolSpec } from "./types";

const MAX_BYTES = 1024 * 1024;

function resolvePath(p: string) {
  if (!p || typeof p !== "string") throw new Error("path must be a non-empty string");
  if (p.startsWith("~")) p = p.replace(/^~/, process.env.HOME ?? "~");
  return path.resolve(p);
}

export const readFile: ToolSpec = {
  name: "read_file",
  group: "fs",
  description: "Read a UTF-8 text file; pageable with offset/limit.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "integer", description: "0-based line offset" },
      limit: { type: "integer", description: "max lines (default 500)" },
    },
    required: ["path"],
  },
  async handler(args) {
    try {
      const p = resolvePath(args.path as string);
      const st = await fs.stat(p);
      if (!st.isFile()) return err("not_a_file", `${p} is not a regular file`);
      if (st.size > MAX_BYTES)
        return err("file_too_large", `${st.size} B (max ${MAX_BYTES})`);
      const offset = Math.max(0, Number(args.offset ?? 0));
      const limit = Math.min(5000, Math.max(1, Number(args.limit ?? 500)));
      const text = await fs.readFile(p, "utf8");
      const lines = text.split("\n");
      const chunk = lines.slice(offset, offset + limit).join("\n");
      return ok({
        path: p,
        content: chunk,
        total_lines: lines.length,
        lines_returned: Math.min(limit, lines.length - offset),
        has_more: offset + limit < lines.length,
      });
    } catch (e) {
      return err("io", (e as Error).message);
    }
  },
};

export const writeFile: ToolSpec = {
  name: "write_file",
  group: "fs",
  description: "Write text to a file (overwrite or append). Creates parent dirs.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      mode: { type: "string", enum: ["overwrite", "append"] },
    },
    required: ["path", "content"],
  },
  async handler(args) {
    try {
      const mode = (args.mode as string) ?? "overwrite";
      if (mode !== "overwrite" && mode !== "append")
        return err("bad_mode", `mode must be overwrite|append, got ${mode}`);
      const p = resolvePath(args.path as string);
      await fs.mkdir(path.dirname(p), { recursive: true });
      const content = String(args.content ?? "");
      if (mode === "append") await fs.appendFile(p, content, "utf8");
      else await fs.writeFile(p, content, "utf8");
      return ok({
        path: p,
        action: mode === "append" ? "appended" : "written",
        bytes_written: Buffer.byteLength(content, "utf8"),
      });
    } catch (e) {
      return err("io", (e as Error).message);
    }
  },
};

export const listDirectory: ToolSpec = {
  name: "list_directory",
  group: "fs",
  description: "List entries in a directory (non-recursive by default).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      show_hidden: { type: "boolean" },
      recursive: { type: "boolean" },
      max_depth: { type: "integer" },
    },
    required: ["path"],
  },
  async handler(args) {
    try {
      const p = resolvePath(args.path as string);
      const showHidden = !!args.show_hidden;
      const recursive = !!args.recursive;
      const maxDepth = Math.min(10, Math.max(1, Number(args.max_depth ?? 3)));
      const entries: Array<{
        name: string;
        type: string;
        path: string;
        size: number;
      }> = [];

      async function walk(dir: string, depth: number) {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const it of items) {
          if (!showHidden && it.name.startsWith(".")) continue;
          const full = path.join(dir, it.name);
          let size = 0;
          let type = "file";
          try {
            const st: Stats = await fs.stat(full);
            size = it.isFile() ? st.size : 0;
            type = it.isDirectory() ? "directory" : "file";
          } catch {
            continue;
          }
          entries.push({ name: it.name, type, path: full, size });
          if (recursive && it.isDirectory() && depth < maxDepth) {
            await walk(full, depth + 1);
          }
        }
      }

      await walk(p, 1);
      entries.sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1,
      );
      return ok({
        path: p,
        entries,
        total: entries.length,
        directories: entries.filter((e) => e.type === "directory").length,
        files: entries.filter((e) => e.type === "file").length,
      });
    } catch (e) {
      return err("io", (e as Error).message);
    }
  },
};

export const searchFiles: ToolSpec = {
  name: "search_files",
  group: "fs",
  description: "Regex search across files under a directory.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      pattern: { type: "string" },
      file_pattern: { type: "string", description: "glob suffix e.g. .ts" },
      max_results: { type: "integer" },
    },
    required: ["path", "pattern"],
  },
  async handler(args) {
    try {
      const root = resolvePath(args.path as string);
      const max = Math.min(500, Math.max(1, Number(args.max_results ?? 50)));
      const suffix = (args.file_pattern as string | undefined) ?? "";
      const re = new RegExp(args.pattern as string, "i");
      const matches: Array<{ file: string; line_number: number; content: string }> = [];

      async function walk(dir: string) {
        if (matches.length >= max) return;
        const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const it of items) {
          if (matches.length >= max) return;
          if (it.name.startsWith(".")) continue;
          const full = path.join(dir, it.name);
          if (it.isDirectory()) {
            await walk(full);
            continue;
          }
          if (!it.isFile()) continue;
          if (suffix && !it.name.endsWith(suffix)) continue;
          try {
            const st = await fs.stat(full);
            if (st.size > MAX_BYTES) continue;
            const text = await fs.readFile(full, "utf8");
            const lines = text.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= max) break;
              if (re.test(lines[i])) {
                matches.push({
                  file: full,
                  line_number: i + 1,
                  content: lines[i].trimEnd().slice(0, 300),
                });
              }
            }
          } catch {
            continue;
          }
        }
      }

      await walk(root);
      return ok({ search_path: root, matches, total_matches: matches.length });
    } catch (e) {
      return err("io", (e as Error).message);
    }
  },
};

export const getFileInfo: ToolSpec = {
  name: "get_file_info",
  group: "fs",
  description: "Size, type, and mtime for a path.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async handler(args) {
    try {
      const p = resolvePath(args.path as string);
      const st = await fs.stat(p);
      return ok({
        path: p,
        name: path.basename(p),
        type: st.isDirectory() ? "directory" : "file",
        size: st.size,
        modified: st.mtimeMs,
      });
    } catch (e) {
      return err("not_found", (e as Error).message);
    }
  },
};

export const pathExists: ToolSpec = {
  name: "path_exists",
  group: "fs",
  description: "Cheap existence check.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async handler(args) {
    try {
      const p = resolvePath(args.path as string);
      const st = await fs.stat(p).catch(() => null);
      return ok({
        path: p,
        exists: !!st,
        is_file: st?.isFile() ?? null,
        is_directory: st?.isDirectory() ?? null,
      });
    } catch (e) {
      return err("bad_path", (e as Error).message);
    }
  },
};

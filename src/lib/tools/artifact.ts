import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { artifactDir, artifactsDir, isValidFilename } from "@/lib/paths";
import { err, ok, type ToolSpec } from "./types";

function slugify(s: string) {
  return (s || "artifact")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40) || "artifact";
}

function validId(id: string) {
  return /^[a-z0-9][a-z0-9-]{0,80}$/.test(id);
}

export const artifactCreate: ToolSpec = {
  name: "artifact_create",
  group: "fs",
  description:
    "Reserve an artifact workspace and return its id + data path. Call BEFORE writing any data files for an artifact. Use the returned id in your later `react-artifact` fence comment.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "kebab-case slug, optional. Auto-generated from title if omitted.",
      },
      title: {
        type: "string",
        description: "short human title; used for the id slug if id is absent",
      },
    },
    required: [],
  },
  async handler(args, ctx) {
    if (!ctx) {
      return err(
        "no_context",
        "artifact_create requires an active chat session",
      );
    }
    const title =
      typeof args.title === "string" && args.title.trim()
        ? args.title.trim()
        : "artifact";
    let id: string;
    if (typeof args.id === "string" && args.id.trim()) {
      const candidate = args.id.trim().toLowerCase();
      if (!validId(candidate)) {
        return err("bad_id", "id must match ^[a-z0-9][a-z0-9-]{0,80}$");
      }
      id = candidate;
    } else {
      id = `${slugify(title)}-${nanoid(8).replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
    }
    const dir = path.join(
      artifactDir(ctx.assistantId, ctx.sessionId, id),
      "files",
    );
    await fs.mkdir(dir, { recursive: true });
    // Also pre-create the artifact root so later meta.json writes don't
    // race on parent creation.
    await fs.mkdir(artifactsDir(ctx.assistantId, ctx.sessionId), {
      recursive: true,
    });
    return ok({
      id,
      files_path: dir,
      hint: `Write data files here with artifact_write_file(id='${id}', filename=..., content=...). Then emit \`\`\`react-artifact with // id: ${id} and call Sahayak.fetchData('<filename>') inside your component.`,
    });
  },
};

export const artifactWriteFile: ToolSpec = {
  name: "artifact_write_file",
  group: "fs",
  description:
    "Write a data file (CSV, JSON, text) into an artifact's files directory. Use this instead of write_file for any file the artifact will load via Sahayak.fetchData.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "artifact id returned by artifact_create",
      },
      filename: {
        type: "string",
        description:
          "basename only, e.g. data.csv, no slashes. alphanumerics, underscore, dot, dash.",
      },
      content: { type: "string", description: "file content as text" },
    },
    required: ["id", "filename", "content"],
  },
  async handler(args, ctx) {
    if (!ctx) {
      return err(
        "no_context",
        "artifact_write_file requires an active chat session",
      );
    }
    const id = String(args.id ?? "");
    const filename = String(args.filename ?? "");
    const content = String(args.content ?? "");
    if (!validId(id)) return err("bad_id", "invalid artifact id");
    if (!isValidFilename(filename))
      return err(
        "bad_filename",
        "filename must be a single basename matching [A-Za-z0-9._-]",
      );
    const dir = path.join(
      artifactDir(ctx.assistantId, ctx.sessionId, id),
      "files",
    );
    await fs.mkdir(dir, { recursive: true });
    const full = path.join(dir, filename);
    await fs.writeFile(full, content, "utf8");
    return ok({
      id,
      path: full,
      bytes: Buffer.byteLength(content, "utf8"),
      hint: `Access inside the artifact via: await Sahayak.fetchData('${filename}')`,
    });
  },
};

#!/usr/bin/env tsx
/**
 * Opt-in migration of legacy memory types.
 *
 * Reads .config/memory.jsonl and produces a new log where:
 *   - episodic, event entries are dropped
 *   - semantic entries are retyped to procedural if they reference a
 *     command/path/CLI; otherwise dropped
 *   - fact, preference, procedural entries pass through unchanged
 *
 * Without --apply, prints the plan to stdout and exits.
 * With --apply, backs up the original log to memory.jsonl.bak-<ts>
 * and writes the migrated log in place.
 *
 * The script does NOT run automatically. Users opt in by running:
 *   npx tsx scripts/migrate-memory-types.ts          # dry-run
 *   npx tsx scripts/migrate-memory-types.ts --apply  # commit
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const CONFIG_DIR = process.env.SAHAYAK_CONFIG_DIR ?? path.join(ROOT, ".config");
const LOG = path.join(CONFIG_DIR, "memory.jsonl");

type Entry = {
  id: string;
  type: string;
  content: string;
  source: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
};
type CreateRec = { op: "create"; entry: Entry };
type UpdateRec = {
  op: "update";
  id: string;
  content: string;
  type?: string;
  updatedAt: number;
  vectorPending?: boolean;
};
type DeleteRec = { op: "delete"; id: string; at: number };
type Rec = CreateRec | UpdateRec | DeleteRec;

const COMMAND_HINTS = [
  "/", // any path
  "$(", "&&", "||", "|",
  "bash", "zsh", "sh ", "exec",
  "curl", "wget", "git ",
  "npm", "npx", "yarn", "pnpm",
  "python", "node ", "ruby",
  "venv", ".env", "PATH=",
  "--", "-n ", "-h ", "-v",
];

function shouldRetypeSemanticToProcedural(content: string): boolean {
  const c = content.toLowerCase();
  return COMMAND_HINTS.some((h) => c.includes(h.toLowerCase()));
}

function classify(entry: Entry): "keep" | "drop" | "retype-procedural" {
  switch (entry.type) {
    case "fact":
    case "preference":
    case "procedural":
      return "keep";
    case "episodic":
    case "event":
      return "drop";
    case "semantic":
      return shouldRetypeSemanticToProcedural(entry.content)
        ? "retype-procedural"
        : "drop";
    default:
      return "keep";
  }
}

function main() {
  const apply = process.argv.includes("--apply");
  if (!fs.existsSync(LOG)) {
    console.error(`No memory log at ${LOG}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(LOG, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const records: Rec[] = lines.map((l) => JSON.parse(l) as Rec);

  // Replay to a live id-set + entry map so we know what ends up live.
  const live = new Map<string, Entry>();
  for (const r of records) {
    if (r.op === "create") live.set(r.entry.id, { ...r.entry });
    else if (r.op === "update") {
      const cur = live.get(r.id);
      if (cur) {
        cur.content = r.content;
        if (r.type) cur.type = r.type;
        cur.updatedAt = r.updatedAt;
      }
    } else if (r.op === "delete") {
      live.delete(r.id);
    }
  }

  const decisions: { id: string; type: string; action: string; preview: string }[] = [];
  const idsToDrop = new Set<string>();
  const idsToRetype = new Map<string, string>();

  for (const e of live.values()) {
    const decision = classify(e);
    decisions.push({
      id: e.id,
      type: e.type,
      action: decision,
      preview: e.content.slice(0, 80),
    });
    if (decision === "drop") idsToDrop.add(e.id);
    else if (decision === "retype-procedural")
      idsToRetype.set(e.id, "procedural");
  }

  console.log(`Total live memories: ${live.size}`);
  console.log(`To drop: ${idsToDrop.size}`);
  console.log(`To retype → procedural: ${idsToRetype.size}`);
  console.log(`Unchanged: ${live.size - idsToDrop.size - idsToRetype.size}`);
  console.log("");
  for (const d of decisions) {
    console.log(`  [${d.action.padEnd(18)}] ${d.type.padEnd(10)} ${d.id}  ${d.preview}`);
  }

  if (!apply) {
    console.log("");
    console.log("Dry run only. Re-run with --apply to commit.");
    return;
  }

  const backupPath = `${LOG}.bak-${Date.now()}`;
  fs.copyFileSync(LOG, backupPath);
  console.log("");
  console.log(`Backed up original to ${backupPath}`);

  // Append delete records for drops, update records for retypes.
  // We don't rewrite the existing log — append-only keeps history clean
  // and reversible by hand.
  const now = Date.now();
  const appended: string[] = [];
  for (const id of idsToDrop) {
    appended.push(JSON.stringify({ op: "delete", id, at: now } satisfies DeleteRec));
  }
  for (const [id, newType] of idsToRetype) {
    const cur = live.get(id);
    if (!cur) continue;
    appended.push(
      JSON.stringify({
        op: "update",
        id,
        content: cur.content,
        type: newType,
        updatedAt: now,
      } satisfies UpdateRec),
    );
  }
  fs.appendFileSync(LOG, appended.join("\n") + (appended.length ? "\n" : ""));
  console.log(`Appended ${appended.length} migration record(s) to ${LOG}.`);
  console.log("Tip: hit Rebuild on the settings page to re-embed.");
}

main();

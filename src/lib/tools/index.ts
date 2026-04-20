import type { ToolSpec } from "./types";
import {
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  getFileInfo,
  pathExists,
} from "./fs";
import { executeCommand } from "./shell";
import { webSearch, webFetch } from "./web";
import { gmailSearch, gmailHeaders, gmailBody, gmailThread } from "./gmail";

export const ALL_TOOLS: ToolSpec[] = [
  readFile,
  writeFile,
  listDirectory,
  searchFiles,
  getFileInfo,
  pathExists,
  executeCommand,
  webSearch,
  webFetch,
  gmailSearch,
  gmailHeaders,
  gmailBody,
  gmailThread,
];

export const TOOLS_BY_NAME = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);

export function toolsForOllama(enabled: string[]) {
  return ALL_TOOLS.filter((t) => enabled.includes(t.name)).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function publicList() {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    group: t.group,
    description: t.description,
  }));
}

export type { ToolSpec };

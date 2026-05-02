import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";
import { setFrontmatter } from "../frontmatter.js";

const ACTIONS_DIR = join(homedir(), "agntux", "actions");

function guardPath(id: string): string {
  const resolved = resolve(ACTIONS_DIR, `${id}.md`);
  const rel = relative(ACTIONS_DIR, resolved);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error(`Path traversal rejected: id "${id}" resolves outside ~/agntux-code/actions/`);
  }
  return resolved;
}

export const dismissTool = {
  description: "Dismiss an action item (mark it as not worth acting on).",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "Action item ID (filename without .md)" },
    },
    required: ["id"],
  },
  async handler(args: Record<string, unknown>) {
    const id = String(args.id ?? "");
    if (!id) throw new Error("id is required");

    const filePath = guardPath(id);
    const file = readFileSync(filePath, "utf8");
    const updated = setFrontmatter(file, {
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      completed_at: null,
    });
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, updated, { mode: 0o644 });
    renameSync(tmp, filePath);
    return { content: [{ type: "text", text: `Dismissed ${id}.` }] };
  },
};

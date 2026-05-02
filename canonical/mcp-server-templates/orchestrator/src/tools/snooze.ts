import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";
import { setFrontmatter } from "../frontmatter.js";

const ACTIONS_DIR = join(homedir(), "agntux", "actions");

function guardPath(id: string): string {
  // Reject any id containing path separators or traversal sequences.
  // Use resolve + relative check — not string-prefix comparison.
  const resolved = resolve(ACTIONS_DIR, `${id}.md`);
  const rel = relative(ACTIONS_DIR, resolved);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    // rel is absolute (didn't relativize) or escapes the dir.
    throw new Error(`Path traversal rejected: id "${id}" resolves outside ~/agntux-code/actions/`);
  }
  return resolved;
}

export const snoozeTool = {
  description: "Snooze an action item until a specified date.",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "Action item ID (filename without .md)" },
      until: { type: "string", description: "ISO date or RFC 3339 timestamp" },
    },
    required: ["id", "until"],
  },
  async handler(args: Record<string, unknown>) {
    const id = String(args.id ?? "");
    const until = String(args.until ?? "");
    if (!id) throw new Error("id is required");
    if (!until) throw new Error("until is required");

    const filePath = guardPath(id);
    const file = readFileSync(filePath, "utf8");
    const updated = setFrontmatter(file, {
      status: "snoozed",
      snoozed_until: until,
      completed_at: null,
      dismissed_at: null,
    });
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, updated, { mode: 0o644 });
    renameSync(tmp, filePath);
    return { content: [{ type: "text", text: `Snoozed ${id} until ${until}.` }] };
  },
};

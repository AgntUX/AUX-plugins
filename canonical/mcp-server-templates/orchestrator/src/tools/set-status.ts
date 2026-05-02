import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { setFrontmatter } from "../frontmatter.js";
import { expectedAgntuxRoot } from "../agntux-root.js";

const VALID_STATUSES = new Set(["open", "snoozed", "done", "dismissed"]);

function actionsDir(): string {
  return join(expectedAgntuxRoot(), "actions");
}

function guardPath(id: string): string {
  const dir = actionsDir();
  const resolved = resolve(dir, `${id}.md`);
  const rel = relative(dir, resolved);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error(`Path traversal rejected: id "${id}" resolves outside <agntux project root>/actions/`);
  }
  return resolved;
}

export const setStatusTool = {
  description: "Set the status of an action item (open, snoozed, done, or dismissed).",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "Action item ID (filename without .md)" },
      status: {
        type: "string",
        enum: ["open", "snoozed", "done", "dismissed"],
        description: "New status value",
      },
      snoozed_until: {
        type: "string",
        description: "ISO date or RFC 3339 timestamp (required when status is snoozed)",
      },
    },
    required: ["id", "status"],
  },
  async handler(args: Record<string, unknown>) {
    const id = String(args.id ?? "");
    const status = String(args.status ?? "");
    if (!id) throw new Error("id is required");
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`Invalid status "${status}". Must be one of: open, snoozed, done, dismissed`);
    }
    if (status === "snoozed" && !args.snoozed_until) {
      throw new Error("snoozed_until is required when status is snoozed");
    }

    const filePath = guardPath(id);
    const file = readFileSync(filePath, "utf8");

    const patch: Record<string, unknown> = { status };
    const now = new Date().toISOString();
    if (status === "done") {
      patch.completed_at = now;
      patch.dismissed_at = null;
    } else if (status === "dismissed") {
      patch.dismissed_at = now;
      patch.completed_at = null;
    } else if (status === "snoozed") {
      patch.snoozed_until = args.snoozed_until;
      patch.completed_at = null;
      patch.dismissed_at = null;
    } else if (status === "open") {
      patch.snoozed_until = null;
      patch.completed_at = null;
      patch.dismissed_at = null;
    }

    const updated = setFrontmatter(file, patch);
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, updated, { mode: 0o644 });
    renameSync(tmp, filePath);
    return { content: [{ type: "text", text: `Set status of ${id} to ${status}.` }] };
  },
};

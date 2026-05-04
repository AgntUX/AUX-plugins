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

// Append an `## Outcome` body section to an action item file. Read by
// `pattern-feedback` to distinguish positive dismissals (the user
// completed-elsewhere) from negative dismissals (genuine noise) — see
// `agents/pattern-feedback.md` → "How to read dismissals".
export function appendOutcomeSection(
  file: string,
  outcome: string,
  note?: string,
): string {
  const stamp = new Date().toISOString();
  const noteLine = note ? `\n${note.trim()}` : "";
  const block = `\n## Outcome\n${outcome} — ${stamp}${noteLine}\n`;
  // Idempotency: if a previous `## Outcome` exists, append a new one below it
  // rather than rewriting (the body is append-only history per P3 §3.2.1).
  return file.endsWith("\n") ? file + block : file + "\n" + block;
}

export const setStatusTool = {
  description:
    "Set the status of an action item (open, snoozed, done, or dismissed). Optionally captures user intent via `outcome` — `completed-externally`, `noise`, `irrelevant`, or any free-form string — appended as an `## Outcome` body section. pattern-feedback reads this to distinguish positive dismissals from negative.",
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
      outcome: {
        type: "string",
        description:
          "Optional intent marker for done/dismissed transitions. Suggested values: `completed-externally`, `noise`, `irrelevant`. Free-form strings allowed. Appends a `## Outcome` body section. pattern-feedback reads this to distinguish completion-elsewhere (positive) from genuine noise (negative).",
      },
      outcome_note: {
        type: "string",
        description: "Optional free-form note appended to the `## Outcome` body section.",
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

    let updated = setFrontmatter(file, patch);
    const outcomeArg = typeof args.outcome === "string" ? args.outcome.trim() : "";
    const outcomeNote =
      typeof args.outcome_note === "string" ? args.outcome_note.trim() : undefined;
    if (outcomeArg && (status === "done" || status === "dismissed")) {
      updated = appendOutcomeSection(updated, outcomeArg, outcomeNote);
    }

    const tmp = filePath + ".tmp";
    writeFileSync(tmp, updated, { mode: 0o644 });
    renameSync(tmp, filePath);

    const outcomeSuffix = outcomeArg && (status === "done" || status === "dismissed")
      ? ` (outcome: ${outcomeArg})`
      : "";
    return { content: [{ type: "text", text: `Set status of ${id} to ${status}${outcomeSuffix}.` }] };
  },
};

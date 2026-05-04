import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { setFrontmatter } from "../frontmatter.js";
import { expectedAgntuxRoot } from "../agntux-root.js";
import { appendOutcomeSection } from "./set-status.js";

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

export const dismissTool = {
  description:
    "Dismiss an action item (mark it as not worth acting on). Optionally captures user intent via `outcome` — `noise`, `irrelevant`, `completed-externally`, or any free-form string — appended as an `## Outcome` body section. pattern-feedback reads this to distinguish genuine noise from completion-elsewhere; without an outcome, the dismissal is treated as ambiguous.",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "Action item ID (filename without .md)" },
      outcome: {
        type: "string",
        description:
          "Optional intent marker. Suggested: `noise`, `irrelevant`, `completed-externally`. Free-form strings allowed. Appends a `## Outcome` body section. pattern-feedback only counts dismissals toward `→ deprioritize` patterns when an outcome marker (or paired `# Never raise` capture) is present.",
      },
      outcome_note: {
        type: "string",
        description: "Optional free-form note appended to the `## Outcome` body section.",
      },
    },
    required: ["id"],
  },
  async handler(args: Record<string, unknown>) {
    const id = String(args.id ?? "");
    if (!id) throw new Error("id is required");

    const filePath = guardPath(id);
    const file = readFileSync(filePath, "utf8");
    let updated = setFrontmatter(file, {
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      completed_at: null,
    });

    const outcomeArg = typeof args.outcome === "string" ? args.outcome.trim() : "";
    const outcomeNote =
      typeof args.outcome_note === "string" ? args.outcome_note.trim() : undefined;
    if (outcomeArg) {
      updated = appendOutcomeSection(updated, outcomeArg, outcomeNote);
    }

    const tmp = filePath + ".tmp";
    writeFileSync(tmp, updated, { mode: 0o644 });
    renameSync(tmp, filePath);
    const outcomeSuffix = outcomeArg ? ` (outcome: ${outcomeArg})` : "";
    return { content: [{ type: "text", text: `Dismissed ${id}${outcomeSuffix}.` }] };
  },
};

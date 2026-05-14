import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { setFrontmatter } from "../frontmatter.js";
import {
  describeScope,
  readScopeFromArgs,
  resolveActionPath,
  SCOPE_INPUT_SCHEMA_FRAGMENT,
} from "./scope.js";

const VALID_STATUSES = new Set(["open", "snoozed", "done", "dismissed"]);

// Validates the optional team-wide done-attribution args before they're
// written into action-file frontmatter. Slugs match the same lowercase-
// alphanumeric-with-dashes rule used elsewhere in the plugin; user IDs
// are accepted as opaque strings (UUIDs are the common case but the
// plugin doesn't pin the format), bounded to 128 chars so a buggy
// caller can't balloon the frontmatter.
const USER_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const USER_ID_MAX = 128;

function readDoneAttribution(args: Record<string, unknown>): {
  user_slug: string | null;
  user_id: string | null;
} {
  const slugRaw = typeof args.user_slug === "string" ? args.user_slug.trim() : "";
  const idRaw = typeof args.user_id === "string" ? args.user_id.trim() : "";
  const slug = slugRaw && USER_SLUG_RE.test(slugRaw) ? slugRaw : null;
  const id = idRaw && idRaw.length <= USER_ID_MAX ? idRaw : null;
  return { user_slug: slug, user_id: id };
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
    "Set the status of an action item (open, snoozed, done, or dismissed). Optionally captures user intent via `outcome` — `completed-externally`, `noise`, `irrelevant`, or any free-form string — appended as an `## Outcome` body section. pattern-feedback reads this to distinguish positive dismissals from negative. Defaults to the personal `<root>/actions/` scope; pass `team_slug` or `view_slug` to mutate a team- or leader-view-scoped item instead (team mode). For team / leader-view scoped mark-done, also writes `done_by_user_slug`, `done_by_user_id`, and `done_at` when `user_slug` / `user_id` are provided — these are the team-wide audit fields visible to every member after sync.",
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
      user_slug: {
        type: "string",
        description:
          "Optional. The mutator's user-slug. When status is `done` on a team or leader-view scope, this is written to the action file as `done_by_user_slug` so every team member's triage UI can attribute the mark-done after sync. Ignored on personal scope. Must match the strict slug pattern (lowercase alphanumeric + dashes).",
      },
      user_id: {
        type: "string",
        description:
          "Optional. The mutator's canonical user identity (typically a UUID). When status is `done` on a team or leader-view scope, this is written to the action file as `done_by_user_id`. Ignored on personal scope.",
      },
      ...SCOPE_INPUT_SCHEMA_FRAGMENT,
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

    const scope = readScopeFromArgs(args);
    const filePath = resolveActionPath(id, scope);
    const file = readFileSync(filePath, "utf8");

    const patch: Record<string, unknown> = { status };
    const now = new Date().toISOString();
    // Mark-done attribution (P9 §"Action-file mark-done semantics"):
    //   - team / leader-view scope: write `done_by_user_slug`,
    //     `done_by_user_id`, `done_at` so every member's synced view
    //     sees who closed the item and when.
    //   - personal scope: skip the attribution fields; the action lives
    //     in the user's own data root and `completed_at` is enough.
    //   - re-opening / snoozing / dismissing: clear the attribution
    //     fields so a stale "Done by Alice" doesn't survive a re-open.
    const scopeIsTeamOrLeader = !!(scope?.team_slug || scope?.view_slug);
    if (status === "done") {
      patch.completed_at = now;
      patch.dismissed_at = null;
      if (scopeIsTeamOrLeader) {
        const { user_slug, user_id } = readDoneAttribution(args);
        if (user_slug) patch.done_by_user_slug = user_slug;
        if (user_id) patch.done_by_user_id = user_id;
        patch.done_at = now;
      }
    } else if (status === "dismissed") {
      patch.dismissed_at = now;
      patch.completed_at = null;
      if (scopeIsTeamOrLeader) {
        patch.done_by_user_slug = null;
        patch.done_by_user_id = null;
        patch.done_at = null;
      }
    } else if (status === "snoozed") {
      patch.snoozed_until = args.snoozed_until;
      patch.completed_at = null;
      patch.dismissed_at = null;
      if (scopeIsTeamOrLeader) {
        patch.done_by_user_slug = null;
        patch.done_by_user_id = null;
        patch.done_at = null;
      }
    } else if (status === "open") {
      patch.snoozed_until = null;
      patch.completed_at = null;
      patch.dismissed_at = null;
      if (scopeIsTeamOrLeader) {
        patch.done_by_user_slug = null;
        patch.done_by_user_id = null;
        patch.done_at = null;
      }
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
    return {
      content: [
        {
          type: "text",
          text: `Set status of ${id} to ${status}${outcomeSuffix}${describeScope(scope)}.`,
        },
      ],
    };
  },
};

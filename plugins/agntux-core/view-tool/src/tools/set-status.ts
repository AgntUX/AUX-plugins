// Full status state machine for action items.
//
// Ported from `mcp-server/src/tools/set-status.ts` — same transitions and
// audit-field semantics, but writes go through `ctx.fs.update()` with the
// remote MCP server's CAS-retry contract.

import type {
  MutationTool,
  ViewToolContext,
} from "@agntux/plugin-runtime";
import { setFrontmatter } from "./frontmatter.js";
import { appendOutcomeSection } from "./outcome.js";
import {
  describeScope,
  readScopeFromArgs,
  resolveActionPath,
  SCOPE_INPUT_SCHEMA_FRAGMENT,
} from "./scope.js";

const VALID_STATUSES = new Set(["open", "snoozed", "done", "dismissed"]);

interface SetStatusArgs {
  id: string;
  status: string;
  snoozed_until?: string;
  outcome?: string;
  outcome_note?: string;
  user_slug?: string;
  user_id?: string;
  team_slug?: string;
  view_slug?: string;
}

export const setStatusTool: MutationTool<SetStatusArgs> = {
  descriptor: {
    name: "agntux_core_set_status",
    description:
      "Set the status of an action item (open, snoozed, done, or dismissed). Optionally captures user intent via `outcome` — `completed-externally`, `noise`, `irrelevant`, or any free-form string — appended as an `## Outcome` body section. pattern-feedback reads this to distinguish positive dismissals from negative. Defaults to the personal `actions/` scope; pass `team_slug` or `view_slug` to mutate a team- or leader-view-scoped item instead (team mode). For team / leader-view scoped mark-done, also writes `done_by_user_slug`, `done_by_user_id`, and `done_at` when `user_slug` / `user_id` are provided — these are the team-wide audit fields visible to every member after sync.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Action item ID (filename without .md)",
        },
        status: {
          type: "string",
          enum: ["open", "snoozed", "done", "dismissed"],
        },
        snoozed_until: {
          type: "string",
          description: "Required when status=snoozed. ISO 8601 timestamp.",
        },
        outcome: {
          type: "string",
          description:
            "Optional intent marker for done/dismissed transitions. Suggested values: `completed-externally`, `noise`, `irrelevant`. Free-form strings allowed.",
        },
        outcome_note: {
          type: "string",
          description:
            "Optional free-form note appended to the `## Outcome` body section.",
        },
        user_slug: {
          type: "string",
          description:
            "Optional. The slug of the user performing the action. Used for team-wide audit fields (done_by_user_slug).",
        },
        user_id: {
          type: "string",
          description:
            "Optional. The id of the user performing the action. Used for team-wide audit fields (done_by_user_id).",
        },
        ...SCOPE_INPUT_SCHEMA_FRAGMENT,
      },
      required: ["id", "status"],
      additionalProperties: false,
    },
  },
  async handle(args, ctx: ViewToolContext) {
    const id = String(args.id ?? "");
    const status = String(args.status ?? "");
    if (!id) throw new Error("id is required");
    if (!VALID_STATUSES.has(status)) {
      throw new Error(
        `Invalid status "${status}". Must be one of: open, snoozed, done, dismissed`,
      );
    }
    if (status === "snoozed" && !args.snoozed_until) {
      throw new Error("snoozed_until is required when status=snoozed");
    }

    const scope = readScopeFromArgs(args as unknown as Record<string, unknown>);
    const filePath = resolveActionPath(id, scope);
    const userSlug =
      typeof args.user_slug === "string" ? args.user_slug.trim() : "";
    const userId =
      typeof args.user_id === "string" ? args.user_id.trim() : "";
    const outcomeArg =
      typeof args.outcome === "string" ? args.outcome.trim() : "";
    const outcomeNote =
      typeof args.outcome_note === "string"
        ? args.outcome_note.trim()
        : undefined;
    const teamScoped = Boolean(scope?.team_slug || scope?.view_slug);

    await ctx.fs.update(filePath, (current) => {
      if (current === null) {
        throw new Error(`action ${id} not found`);
      }
      const now = ctx.now().toISOString();
      const patch: Record<string, unknown> = { status };

      if (status === "open") {
        patch.completed_at = null;
        patch.snoozed_until = null;
        patch.dismissed_at = null;
        if (teamScoped) {
          patch.done_by_user_slug = null;
          patch.done_by_user_id = null;
          patch.done_at = null;
        }
      } else if (status === "done") {
        patch.completed_at = now;
        patch.snoozed_until = null;
        patch.dismissed_at = null;
        if (teamScoped) {
          if (userSlug) patch.done_by_user_slug = userSlug;
          if (userId) patch.done_by_user_id = userId;
          patch.done_at = now;
        }
      } else if (status === "dismissed") {
        patch.dismissed_at = now;
        patch.snoozed_until = null;
        patch.completed_at = null;
        if (teamScoped) {
          patch.done_by_user_slug = null;
          patch.done_by_user_id = null;
          patch.done_at = null;
        }
      } else if (status === "snoozed") {
        patch.snoozed_until = String(args.snoozed_until ?? "");
        patch.completed_at = null;
        patch.dismissed_at = null;
        if (teamScoped) {
          patch.done_by_user_slug = null;
          patch.done_by_user_id = null;
          patch.done_at = null;
        }
      }

      let updated = setFrontmatter(current, patch);
      if (
        outcomeArg &&
        (status === "done" || status === "dismissed")
      ) {
        updated = appendOutcomeSection(updated, outcomeArg, outcomeNote, now);
      }
      return updated;
    });

    const outcomeSuffix =
      outcomeArg && (status === "done" || status === "dismissed")
        ? ` (outcome: ${outcomeArg})`
        : "";
    return {
      content: [
        {
          type: "text" as const,
          text: `Set ${id} → ${status}${outcomeSuffix}${describeScope(scope)}.`,
        },
      ],
    };
  },
};

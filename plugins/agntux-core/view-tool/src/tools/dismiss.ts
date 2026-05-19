// Dismiss an action item.
//
// Ported from `mcp-server/src/tools/dismiss.ts`. Frontmatter flip +
// optional `## Outcome` body append, both in a single CAS-protected
// update.

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

interface DismissArgs {
  id: string;
  outcome?: string;
  outcome_note?: string;
  team_slug?: string;
  view_slug?: string;
}

export const dismissTool: MutationTool<DismissArgs> = {
  descriptor: {
    name: "agntux_core_dismiss",
    description:
      "Dismiss an action item (mark it as not worth acting on). Optionally captures user intent via `outcome` — `noise`, `irrelevant`, `completed-externally`, or any free-form string — appended as an `## Outcome` body section. pattern-feedback reads this to distinguish genuine noise from completion-elsewhere; without an outcome, the dismissal is treated as ambiguous. Defaults to the personal `actions/` scope; pass `team_slug` or `view_slug` to dismiss a team- or leader-view-scoped item instead (team mode).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Action item ID (filename without .md)",
        },
        outcome: {
          type: "string",
          description:
            "Optional intent marker. Suggested: `noise`, `irrelevant`, `completed-externally`. Free-form strings allowed. Appends a `## Outcome` body section.",
        },
        outcome_note: {
          type: "string",
          description:
            "Optional free-form note appended to the `## Outcome` body section.",
        },
        ...SCOPE_INPUT_SCHEMA_FRAGMENT,
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  async handle(args, ctx: ViewToolContext) {
    const id = String(args.id ?? "");
    if (!id) throw new Error("id is required");

    const scope = readScopeFromArgs(args as unknown as Record<string, unknown>);
    const filePath = resolveActionPath(id, scope);
    const outcomeArg =
      typeof args.outcome === "string" ? args.outcome.trim() : "";
    const outcomeNote =
      typeof args.outcome_note === "string" ? args.outcome_note.trim() : undefined;

    await ctx.fs.update(filePath, (current) => {
      if (current === null) {
        throw new Error(`action ${id} not found`);
      }
      let updated = setFrontmatter(current, {
        status: "dismissed",
        dismissed_at: ctx.now().toISOString(),
        completed_at: null,
      });
      if (outcomeArg) {
        updated = appendOutcomeSection(
          updated,
          outcomeArg,
          outcomeNote,
          ctx.now().toISOString(),
        );
      }
      return updated;
    });

    const suffix = outcomeArg ? ` (outcome: ${outcomeArg})` : "";
    return {
      content: [
        {
          type: "text" as const,
          text: `Dismissed ${id}${suffix}${describeScope(scope)}.`,
        },
      ],
    };
  },
};

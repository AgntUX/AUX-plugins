// Snooze an action item until a given date.
//
// Ported from `mcp-server/src/tools/snooze.ts`. Writes go through
// `ctx.fs.update()` (read-modify-write with bounded CAS retry) so a
// concurrent edit on the same file gets a clean retry instead of a
// silent lost update.

import type {
  MutationTool,
  ViewToolContext,
} from "@agntux/plugin-runtime";
import { setFrontmatter } from "./frontmatter.js";
import {
  describeScope,
  readScopeFromArgs,
  resolveActionPath,
  SCOPE_INPUT_SCHEMA_FRAGMENT,
} from "./scope.js";

interface SnoozeArgs {
  id: string;
  until: string;
  team_slug?: string;
  view_slug?: string;
}

export const snoozeTool: MutationTool<SnoozeArgs> = {
  descriptor: {
    name: "agntux_core_snooze",
    description:
      "Snooze an action item until a specified date. Defaults to the personal `actions/` scope; pass `team_slug` or `view_slug` to snooze a team- or leader-view-scoped item instead. (team mode).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Action item ID (filename without .md)",
        },
        until: {
          type: "string",
          description: "ISO date or RFC 3339 timestamp",
        },
        ...SCOPE_INPUT_SCHEMA_FRAGMENT,
      },
      required: ["id", "until"],
      additionalProperties: false,
    },
  },
  async handle(args, ctx: ViewToolContext) {
    const id = String(args.id ?? "");
    const until = String(args.until ?? "");
    if (!id) throw new Error("id is required");
    if (!until) throw new Error("until is required");

    const scope = readScopeFromArgs(args as unknown as Record<string, unknown>);
    const filePath = resolveActionPath(id, scope);

    await ctx.fs.update(filePath, (current) => {
      if (current === null) {
        throw new Error(`action ${id} not found`);
      }
      return setFrontmatter(current, {
        status: "snoozed",
        snoozed_until: until,
        completed_at: null,
        dismissed_at: null,
      });
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Snoozed ${id} until ${until}${describeScope(scope)}.`,
        },
      ],
    };
  },
};

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { setFrontmatter } from "../frontmatter.js";
import {
  describeScope,
  readScopeFromArgs,
  resolveActionPath,
  SCOPE_INPUT_SCHEMA_FRAGMENT,
} from "./scope.js";

export const snoozeTool = {
  description:
    "Snooze an action item until a specified date. Defaults to the personal `<root>/actions/` scope; pass `team_slug` or `view_slug` to snooze a team- or leader-view-scoped item instead (team mode).",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "Action item ID (filename without .md)" },
      until: { type: "string", description: "ISO date or RFC 3339 timestamp" },
      ...SCOPE_INPUT_SCHEMA_FRAGMENT,
    },
    required: ["id", "until"],
  },
  async handler(args: Record<string, unknown>) {
    const id = String(args.id ?? "");
    const until = String(args.until ?? "");
    if (!id) throw new Error("id is required");
    if (!until) throw new Error("until is required");

    const scope = readScopeFromArgs(args);
    const filePath = resolveActionPath(id, scope);
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
    return {
      content: [
        {
          type: "text",
          text: `Snoozed ${id} until ${until}${describeScope(scope)}.`,
        },
      ],
    };
  },
};

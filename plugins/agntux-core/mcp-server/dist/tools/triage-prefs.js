// triage-prefs — write the user's UI filter state for the triage view to
// `<root>/.agntux/triage-prefs.json`.
//
// Why a tool, not a host setting:
//   The UI handler lives in an iframe; it has no direct filesystem access
//   and persists state through the MCP server. Per P3 v2 §1, the gate file
//   `<root>/.agntux/teams.json` is a sibling to this file in the same
//   `.agntux/` directory; both are read by the public plugin and written by
//   the appropriate trust boundary (teams.json by agntux-teams, triage-prefs
//   by the public agntux-core UI handler).
//
// Shape rules:
//   - schema_version starts at 1; P9 will extend with mute/snooze defaults.
//   - muted_team_slugs / muted_view_slugs are flat arrays of slugs; the UI
//     filter logic treats absence-from-the-list as "visible".
//   - Slugs are validated against the strict pattern before write so a
//     buggy/malicious caller can't poison the file with traversal-shaped
//     entries.
//
// Atomicity: write to a sibling .tmp file and rename. Matches the snooze
// /dismiss/set-status pattern so the user never sees a half-written
// triage-prefs.json if the process dies mid-write.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectedAgntuxRoot } from "../agntux-root.js";
// Strict slug: 1–64 chars, lowercase + digits + dashes, must start AND end
// with [a-z0-9]. Mirrors the P3 §"Team identifier" rule (no leading or
// trailing dashes, no double dashes is left to authoring to avoid).
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_MUTED_SLUGS = 256;
function sanitizeSlugList(raw) {
    if (!Array.isArray(raw))
        return [];
    const seen = new Set();
    const out = [];
    for (const v of raw) {
        if (typeof v !== "string")
            continue;
        const t = v.trim();
        if (!t || !SLUG_RE.test(t))
            continue;
        if (seen.has(t))
            continue;
        seen.add(t);
        out.push(t);
        if (out.length >= MAX_MUTED_SLUGS)
            break;
    }
    return out;
}
export const triagePrefsTool = {
    description: "Persist the triage UI's filter state for the current AgntUX project. Writes `<root>/.agntux/triage-prefs.json`. Called by the triage MCP App when the user toggles a team or leader-view filter chip; not user-facing.",
    inputSchema: {
        type: "object",
        properties: {
            muted_team_slugs: {
                type: "array",
                items: { type: "string" },
                description: "Team slugs the user has hidden in their triage view.",
            },
            muted_view_slugs: {
                type: "array",
                items: { type: "string" },
                description: "Leader-view slugs the user has hidden in their triage view.",
            },
        },
        required: [],
    },
    async handler(args) {
        const muted_team_slugs = sanitizeSlugList(args.muted_team_slugs);
        const muted_view_slugs = sanitizeSlugList(args.muted_view_slugs);
        const root = expectedAgntuxRoot();
        const dir = join(root, ".agntux");
        const path = join(dir, "triage-prefs.json");
        mkdirSync(dir, { recursive: true });
        const payload = {
            schema_version: 1,
            muted_team_slugs,
            muted_view_slugs,
        };
        // 2-space indent so the file is reviewable by humans without round-
        // tripping through a formatter. Trailing newline for POSIX-friendliness.
        const body = JSON.stringify(payload, null, 2) + "\n";
        const tmp = path + ".tmp";
        writeFileSync(tmp, body, { mode: 0o644 });
        renameSync(tmp, path);
        return {
            content: [
                {
                    type: "text",
                    text: `triage-prefs.json saved (${muted_team_slugs.length} team(s) muted, ${muted_view_slugs.length} view(s) muted).`,
                },
            ],
        };
    },
};

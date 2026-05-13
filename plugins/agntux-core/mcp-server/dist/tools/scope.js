// Shared helper for the inline-mutation tools (snooze, dismiss, set-status).
//
// Personal actions live at `<root>/actions/`. Team-mode (P3 v2) adds
// `<root>/teams/{team_slug}/actions/` and `<root>/leader-views/{view_slug}/actions/`
// as additional write targets. The mutation tools take an optional
// `team_slug` OR `view_slug` arg and route to the matching directory; with
// neither, they fall back to the personal path so the byte-identical
// solo guarantee holds for existing tool callers.
//
// Path traversal is guarded twice:
//   1. The slug is matched against a strict pattern (lowercase + dashes,
//      bounded length) before it's joined into the path. Mirrors the
//      P3 §"Team identifier" decision.
//   2. The final action path is resolve/relative-checked against the
//      enclosing actions dir — same defense the personal-only handler
//      had, just generalized to any scope.
import { resolve, relative, join } from "node:path";
import { expectedAgntuxRoot } from "../agntux-root.js";
// Strict slug pattern shared with triage-view.ts and triage-prefs.ts: 1–64
// chars, lowercase + digits + dashes, must start AND end with [a-z0-9].
// Matches the P3 §"Team identifier" rule (org-slug-like).
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export function resolveActionsDir(scope) {
    const root = expectedAgntuxRoot();
    if (scope?.team_slug && scope?.view_slug) {
        throw new Error("Pass at most one of team_slug or view_slug, not both.");
    }
    if (scope?.team_slug) {
        if (!SLUG_RE.test(scope.team_slug)) {
            throw new Error(`Invalid team_slug "${scope.team_slug}".`);
        }
        return join(root, "teams", scope.team_slug, "actions");
    }
    if (scope?.view_slug) {
        if (!SLUG_RE.test(scope.view_slug)) {
            throw new Error(`Invalid view_slug "${scope.view_slug}".`);
        }
        return join(root, "leader-views", scope.view_slug, "actions");
    }
    return join(root, "actions");
}
// Allowed `id` shape: the same lowercase-alphanumeric-with-dashes pattern as
// slugs, plus dots and digits (so `YYYY-MM-DD-slug` and similar conventions
// work). Critically no `/`, `\`, NUL, or `..` allowed — those are the
// traversal vectors. Up to 128 chars to leave room for date-prefix + slug.
const ID_RE = /^[a-z0-9][a-z0-9.\-]{0,127}$/;
export function resolveActionPath(id, scope) {
    if (typeof id !== "string" || !ID_RE.test(id) || id.includes("..")) {
        // Reject ids with slashes, NULs, uppercase letters, or `..` sequences
        // BEFORE joining into the path. Defense-in-depth before the
        // post-resolve check below. Error message intentionally mentions
        // "path traversal" so callers handling the legacy class of failure
        // (e.g. mutator-tools.test.ts) keep matching without a churny rewrite.
        throw new Error(`Path traversal rejected: invalid action id "${id}".`);
    }
    const dir = resolveActionsDir(scope);
    const resolved = resolve(dir, `${id}.md`);
    // Defense-in-depth post-resolve check: the resolved path must equal the
    // single direct join we expect. This catches any traversal that slipped
    // past the ID_RE (e.g. platform-specific encoding) — if the regex
    // accepted something that resolved to a different file, we throw.
    if (resolved !== join(dir, `${id}.md`)) {
        throw new Error(`Path traversal rejected: id "${id}" resolves outside the action scope.`);
    }
    // Belt-and-braces: also verify the `relative()` of the resolved path
    // doesn't escape (catches the case where `dir` and `resolved` differ
    // only in case on a case-insensitive filesystem, which `===` would
    // miss). `rel` must be exactly `{id}.md` for an in-scope file.
    const rel = relative(dir, resolved);
    if (rel.startsWith("..") || rel !== `${id}.md`) {
        throw new Error(`Path traversal rejected: id "${id}" resolves outside the action scope.`);
    }
    return resolved;
}
// Shared inputSchema fragment so each mutator tool can copy the team_slug
// / view_slug description verbatim.
export const SCOPE_INPUT_SCHEMA_FRAGMENT = {
    team_slug: {
        type: "string",
        description: "Optional. Route the write to `<root>/teams/{team_slug}/actions/` instead of personal. Mutually exclusive with view_slug. Omit (solo path) for personal items.",
    },
    view_slug: {
        type: "string",
        description: "Optional. Route the write to `<root>/leader-views/{view_slug}/actions/` instead of personal. Mutually exclusive with team_slug. Omit for personal items.",
    },
};
export function readScopeFromArgs(args) {
    const team_slug = typeof args.team_slug === "string" ? args.team_slug.trim() : "";
    const view_slug = typeof args.view_slug === "string" ? args.view_slug.trim() : "";
    if (team_slug && view_slug) {
        throw new Error("Pass at most one of team_slug or view_slug, not both.");
    }
    if (team_slug)
        return { team_slug };
    if (view_slug)
        return { view_slug };
    return undefined;
}
export function describeScope(scope) {
    if (scope?.team_slug)
        return ` (team: ${scope.team_slug})`;
    if (scope?.view_slug)
        return ` (view: ${scope.view_slug})`;
    return "";
}

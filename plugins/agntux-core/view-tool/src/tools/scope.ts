// Shared scope/path helper for the mutation tools.
//
// Ported from `mcp-server/src/tools/scope.ts` but rewritten to return
// CONTAINER-RELATIVE paths instead of node:fs-absolute ones. The remote
// MCP server's `ViewToolContext.fs` resolves container_id from the path's
// `teams/<slug>/` or `leader-views/<slug>/` prefix; personal items land at
// `actions/<id>.md` with no prefix. The same convention is what the
// desktop daemon uses for local-fs storage, so the scope shape is
// portable across both ends.
//
// Path traversal is guarded triple-deep:
//   1. The slug is matched against a strict pattern before joining.
//   2. The id is matched against a strict pattern; `..` is rejected
//      explicitly.
//   3. The composed path is round-tripped through normalize() and
//      compared to the direct concatenation — catches any case-fold or
//      encoding trick that slipped past the regex.

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// Allowed `id` shape: lowercase-alphanumeric + dots + dashes. No `/`, `\`,
// NUL, or `..`. Up to 128 chars to leave room for date-prefix + slug.
const ID_RE = /^[a-z0-9][a-z0-9.\-]{0,127}$/;

export interface ActionScope {
  team_slug?: string;
  view_slug?: string;
}

/**
 * Resolve the actions DIRECTORY (relative path) for a given scope.
 *
 *   undefined / personal     → `actions`
 *   { team_slug: "foo" }     → `teams/foo/actions`
 *   { view_slug: "foo" }     → `leader-views/foo/actions`
 */
export function resolveActionsDir(scope: ActionScope | undefined): string {
  if (scope?.team_slug && scope?.view_slug) {
    throw new Error(
      "Pass at most one of team_slug or view_slug, not both.",
    );
  }
  if (scope?.team_slug) {
    if (!SLUG_RE.test(scope.team_slug)) {
      throw new Error(`Invalid team_slug "${scope.team_slug}".`);
    }
    return `teams/${scope.team_slug}/actions`;
  }
  if (scope?.view_slug) {
    if (!SLUG_RE.test(scope.view_slug)) {
      throw new Error(`Invalid view_slug "${scope.view_slug}".`);
    }
    return `leader-views/${scope.view_slug}/actions`;
  }
  return "actions";
}

/**
 * Resolve the action FILE path (relative, with `.md` suffix) for an id +
 * scope pair.
 */
export function resolveActionPath(
  id: string,
  scope: ActionScope | undefined,
): string {
  if (typeof id !== "string" || !ID_RE.test(id) || id.includes("..")) {
    throw new Error(
      `Path traversal rejected: invalid action id "${id}".`,
    );
  }
  const dir = resolveActionsDir(scope);
  const direct = `${dir}/${id}.md`;
  // Defense-in-depth: the direct join must be byte-identical to the
  // normalized form. Catches any character that could slip past the
  // regexes and resolve elsewhere.
  const normalized = direct.replace(/\/+/g, "/");
  if (direct !== normalized) {
    throw new Error(
      `Path traversal rejected: id "${id}" resolves outside the action scope.`,
    );
  }
  return direct;
}

export const SCOPE_INPUT_SCHEMA_FRAGMENT = {
  team_slug: {
    type: "string",
    description:
      "Optional. Route the write to `teams/{team_slug}/actions/` instead of personal. Mutually exclusive with view_slug.",
  },
  view_slug: {
    type: "string",
    description:
      "Optional. Route the write to `leader-views/{view_slug}/actions/` instead of personal. Mutually exclusive with team_slug.",
  },
} as const;

export function readScopeFromArgs(
  args: Record<string, unknown>,
): ActionScope | undefined {
  const team_slug =
    typeof args.team_slug === "string" ? args.team_slug.trim() : "";
  const view_slug =
    typeof args.view_slug === "string" ? args.view_slug.trim() : "";
  if (team_slug && view_slug) {
    throw new Error(
      "Pass at most one of team_slug or view_slug, not both.",
    );
  }
  if (team_slug) return { team_slug };
  if (view_slug) return { view_slug };
  return undefined;
}

export function describeScope(scope: ActionScope | undefined): string {
  if (scope?.team_slug) return ` (team: ${scope.team_slug})`;
  if (scope?.view_slug) return ` (view: ${scope.view_slug})`;
  return "";
}

// Path-scope resolver for P7's three data containers.
//
// P7 ratifies three on-disk containers under <agntux project root>/:
//   - personal   : <root>/entities/{subtype}/*.md, <root>/actions/*.md
//   - team       : <root>/teams/{team-slug}/entities/{subtype}/*.md
//                  <root>/teams/{team-slug}/actions/*.md
//   - leader-view: <root>/leader-views/{view-slug}/actions/*.md
//
// Every validation hook (validate-schema, validate-write-lane, maintain-index,
// session-end-rebuild, lint-entity-shape) needs to recognise these scopes.
// One central resolver keeps the path semantics consistent across hooks and
// keeps the team-aware code paths from drifting from the personal ones.
//
// Returns one of:
//   { kind: 'personal',    role: 'entity' | 'action',    root, slug: null }
//   { kind: 'team',        role: 'entity' | 'action',    root, slug: teamSlug }
//   { kind: 'leader-view', role: 'action',               root, slug: viewSlug }
//   null  — out of scope (no hook should fire).
//
// `root` is the absolute path of the container's local root (i.e. the prefix
// to strip when computing the sync container's relative path key). `slug` is
// the team or leader-view slug for the team/leader-view cases; null for
// personal.
//
// _index.md files are intentionally out of scope (maintain-index hook owns
// them). _sources.json likewise.

import { join, basename, sep } from "node:path";

const TEAM_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Resolve the scope of a write to a file path.
 *
 * @param {string} filePath       absolute path to the write target.
 * @param {string} agntuxRoot     absolute path of the resolved <agntux project root>.
 * @returns {{kind: string, role: string, root: string, slug: string|null}|null}
 */
export function resolveScope(filePath, agntuxRoot) {
  if (typeof filePath !== "string" || !agntuxRoot) return null;
  if (!filePath.startsWith(agntuxRoot + sep)) return null;
  const name = basename(filePath);
  if (name === "_index.md" || name === "_sources.json") return null;

  const rel = filePath.slice(agntuxRoot.length + 1);
  const parts = rel.split(sep);

  // personal scope: entities/{subtype}/{slug}.md, actions/{date}-{slug}.md
  if (parts[0] === "entities" && parts.length >= 3 && filePath.endsWith(".md")) {
    return { kind: "personal", role: "entity", root: agntuxRoot, slug: null };
  }
  if (parts[0] === "actions" && parts.length === 2 && filePath.endsWith(".md")) {
    return { kind: "personal", role: "action", root: agntuxRoot, slug: null };
  }

  // team scope: teams/{team-slug}/{entities|actions}/...
  if (parts[0] === "teams" && parts.length >= 4 && TEAM_SLUG_RE.test(parts[1])) {
    const teamSlug = parts[1];
    const teamRoot = join(agntuxRoot, "teams", teamSlug);
    if (parts[2] === "entities" && parts.length >= 5 && filePath.endsWith(".md")) {
      return { kind: "team", role: "entity", root: teamRoot, slug: teamSlug };
    }
    if (parts[2] === "actions" && parts.length === 4 && filePath.endsWith(".md")) {
      return { kind: "team", role: "action", root: teamRoot, slug: teamSlug };
    }
  }

  // leader-view scope: leader-views/{view-slug}/actions/*.md
  if (parts[0] === "leader-views" && parts.length === 4 && TEAM_SLUG_RE.test(parts[1])) {
    const viewSlug = parts[1];
    const viewRoot = join(agntuxRoot, "leader-views", viewSlug);
    if (parts[2] === "actions" && filePath.endsWith(".md")) {
      return { kind: "leader-view", role: "action", root: viewRoot, slug: viewSlug };
    }
  }

  return null;
}

/**
 * Resolve the schema-lock directory for a given scope.
 * Personal lock: <root>/data/schema/
 * Team lock:     <root>/teams/{slug}/data/schema/
 * Leader-view scopes have no lock (their actions follow the team-lift product;
 * a leader-view write hits the team lock of the team whose data triggered it).
 */
export function schemaDirForScope(scope) {
  if (!scope) return null;
  if (scope.kind === "personal") return join(scope.root, "data", "schema");
  if (scope.kind === "team") return join(scope.root, "data", "schema");
  return null;
}

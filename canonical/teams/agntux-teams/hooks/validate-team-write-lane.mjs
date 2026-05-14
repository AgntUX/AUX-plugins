#!/usr/bin/env node
// PreToolUse: enforce per-team write-lane authorization for any Write/Edit
// landing under <agntux project root>/teams/ or <agntux project root>/leader-views/.
//
// The "authorization" check reads the team's
//   <root>/teams/{team-slug}/data/team-config.md
// frontmatter `authorized_plugins:` list. A write attributed to a plugin slug
// not in that list is rejected with a runbook.
//
// Plugin attribution comes from the CLAUDE_PLUGIN_NAME env var (the host sets
// this when the hook fires). When missing (e.g., a manual user edit outside
// any plugin context), the hook passes through silently — manual user
// authority isn't gated by the team's authorized_plugins list.
//
// Path scope:
//   - <root>/teams/{slug}/...      → check team-config authorization
//   - <root>/leader-views/{slug}/... → only `agntux-teams` may write
//   - everything else              → pass-through silent (other plugins'
//                                    write-lane validators handle their
//                                    own paths)
//
// Index files (`_index.md`, `_sources.json`) are owned by `agntux-teams`'
// own `maintain-team-index` PostToolUse hook — those are accepted without
// the authorized-plugins check (the hook always runs as agntux-teams).

import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";

// Resolved lazily on each call so the test seam (`_setAgntuxRootForTesting`)
// works without re-importing this module. Also normalises path separators so
// `startsWith(root + "/")` comparisons stay correct on systems that mix `\`
// and `/` in their absolute paths.
function roots() {
  const r = resolveAgntuxRoot();
  return {
    agntuxRoot: r,
    teamsRoot: r ? join(r, "teams") : null,
    leaderViewsRoot: r ? join(r, "leader-views") : null,
  };
}

function norm(p) {
  if (typeof p !== "string") return p;
  return p.replace(/\\+/g, "/");
}

function readToolContext() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function pass() {
  process.exit(0);
}

function reject(reason) {
  process.stderr.write(`team-write-lane-validator: ${reason}\n`);
  process.exit(2);
}

// Resolve the team-slug for a path under <root>/teams/{slug}/...
// Returns the slug or null when the path isn't under teams/ at all.
function teamSlugFor(filePath) {
  const { teamsRoot } = roots();
  if (!teamsRoot || typeof filePath !== "string") return null;
  const fp = norm(filePath);
  const root = norm(teamsRoot);
  if (!fp.startsWith(root + "/")) return null;
  const tail = fp.slice(root.length + 1);
  const firstSep = tail.indexOf("/");
  if (firstSep === -1) return null;
  return tail.slice(0, firstSep);
}

function leaderViewSlugFor(filePath) {
  const { leaderViewsRoot } = roots();
  if (!leaderViewsRoot || typeof filePath !== "string") return null;
  const fp = norm(filePath);
  const root = norm(leaderViewsRoot);
  if (!fp.startsWith(root + "/")) return null;
  const tail = fp.slice(root.length + 1);
  const firstSep = tail.indexOf("/");
  if (firstSep === -1) return null;
  return tail.slice(0, firstSep);
}

// Read the team's authorized_plugins list from its team-config.md frontmatter.
// Returns an array of slugs; empty array when team-config is missing or has
// no authorized_plugins key.
function authorizedPluginsForTeam(teamSlug) {
  const { teamsRoot } = roots();
  if (!teamsRoot) return [];
  const cfgPath = join(teamsRoot, teamSlug, "data", "team-config.md");
  if (!existsSync(cfgPath)) return [];
  let content;
  try {
    content = readFileSync(cfgPath, "utf8");
  } catch {
    return [];
  }
  const { frontmatter } = parseFrontmatter(content);
  const list = frontmatter.authorized_plugins;
  if (!Array.isArray(list)) return [];
  return list.map((s) => String(s).trim()).filter((s) => s.length > 0);
}

// Index files maintained by the postToolUse maintain-team-index hook.
function isHookOwnedIndex(filePath) {
  const name = basename(filePath);
  return name === "_index.md" || name === "_sources.json";
}

function main() {
  const ctx = readToolContext();
  if (!ctx) pass();
  if (ctx.tool_name !== "Write" && ctx.tool_name !== "Edit") pass();

  const filePath = ctx.tool_input?.file_path;
  if (typeof filePath !== "string") pass();

  // Out of scope: not under teams/ or leader-views/.
  const teamSlug = teamSlugFor(filePath);
  const viewSlug = leaderViewSlugFor(filePath);
  if (!teamSlug && !viewSlug) pass();

  // Plugin attribution. The host sets CLAUDE_PLUGIN_NAME when the hook
  // fires from a plugin-attributed Write/Edit. Manual user edits outside
  // any plugin context have no slug — pass through; user authority is
  // not gated by team-config.
  const writerSlug = (process.env.CLAUDE_PLUGIN_NAME || "").trim();
  if (!writerSlug) pass();

  // Hook-owned index files always pass; the maintain-team-index PostToolUse
  // hook is the authorized writer (and runs as agntux-teams anyway).
  if (isHookOwnedIndex(filePath)) pass();

  // Leader-view paths: only agntux-teams may write.
  if (viewSlug) {
    if (writerSlug === "agntux-teams") pass();
    reject(
      `\`${writerSlug}\` attempted to write under \`leader-views/${viewSlug}/\` ` +
      `(\`${filePath}\`). Only \`agntux-teams\` is authorized to write under leader-views/. ` +
      `If you're a source plugin trying to feed leader-view data, write to your personal lanes ` +
      `(\`<root>/entities/\`, \`<root>/actions/\`); the agntux-teams scheduled task will lift it ` +
      `into the leader view per the rule body.`,
    );
  }

  // Team paths: check the team's authorized_plugins list.
  const authorized = authorizedPluginsForTeam(teamSlug);
  if (authorized.length === 0) {
    // Team not yet onboarded (no team-config.md) — only agntux-teams may
    // write (it's the one that will create team-config.md during onboarding).
    if (writerSlug === "agntux-teams") pass();
    reject(
      `\`${writerSlug}\` attempted to write under \`teams/${teamSlug}/\` ` +
      `(\`${filePath}\`), but team \`${teamSlug}\` has no \`team-config.md\` yet ` +
      `(team-lead onboarding has not completed). Only \`agntux-teams\` may write here ` +
      `until \`/agntux-teams onboard:team-lead ${teamSlug}\` finishes. ` +
      `If you're a source plugin, write to your personal lanes (\`<root>/entities/\`, \`<root>/actions/\`); ` +
      `the agntux-teams scheduled task will lift relevant data into the team's data root.`,
    );
  }

  if (authorized.includes(writerSlug)) pass();

  reject(
    `\`${writerSlug}\` is not in \`teams/${teamSlug}/data/team-config.md\`'s ` +
    `\`authorized_plugins:\` list (allowed: ${authorized.map((s) => `\`${s}\``).join(", ")}). ` +
    `Refusing the write to \`${filePath}\`. ` +
    `If \`${writerSlug}\` should be authorized for team \`${teamSlug}\`, the team lead ` +
    `must add it via \`/agntux-teams onboard:team-lead ${teamSlug}\` (re-entry mode) — ` +
    `do NOT hand-edit \`team-config.md\` to add the slug.`,
  );
}

main();

#!/usr/bin/env node
// PostToolUse: maintain per-team _index.md, _sources.json, and the
// trigger_key_index map under
//   <agntux project root>/teams/{team-slug}/{entities,actions}/...
// AND under
//   <agntux project root>/leader-views/{view-slug}/actions/...
//
// Path-filtered: exits silently for changes outside teams/ + leader-views/.
// Deterministic — regex parsing, no LLM. Mirrors agntux-core's
// maintain-index.mjs structure but per-team-scoped, plus the
// trigger_key_index extension P9 introduces.
//
// What this hook owns (relative to the team / view's data root):
//   - entities/_index.md (per-subtype, plus the rollup at entities/_index.md)
//   - entities/_sources.json (cross-entity index)
//   - actions/_index.md including the `trigger_key_index:` frontmatter map
//
// What it does NOT touch:
//   - any data/ file (schema, config, instructions, members, cursors, audit)
//   - leader-views/ entities (there are none — leader views ship action-only
//     per P7's note)

import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  fsyncSync,
  openSync,
  closeSync,
  readdirSync,
} from "node:fs";
import { join, dirname, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";
import { computeTriggerKey, resolveTriggerInputs } from "./lib/trigger-key.mjs";

// Resolved lazily on each call so the test seam (`_setAgntuxRootForTesting`)
// in agntux-root.mjs works without re-importing this module.
function roots() {
  const r = resolveAgntuxRoot();
  return {
    agntuxRoot: r,
    teamsRoot: r ? join(r, "teams") : null,
    leaderViewsRoot: r ? join(r, "leader-views") : null,
  };
}

function readToolContext() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

// Normalize a filesystem path for prefix-comparison. The byte-frozen
// frontmatter parser is the lowest-common-denominator YAML reader and the
// canonical agntux-root resolver emits POSIX-style joins; on systems that
// mix separators (rare; tests run on darwin), this collapses any drift so
// `filePath.startsWith(root + sep)` comparisons stay correct.
function norm(p) {
  if (typeof p !== "string") return p;
  return p.replace(/\\+/g, "/");
}

// Augmented frontmatter reader: parses the byte-frozen frontmatter.mjs's
// scalar/list/one-level-map shapes, AND extracts the team-action
// `entity_refs:` list-of-maps shape that the byte-frozen parser doesn't
// understand. Returns the merged frontmatter object.
function readFrontmatterWithEntityRefs(raw) {
  const { frontmatter, body: _body } = parseFrontmatter(raw);
  // If the byte-frozen parser produced an entity_refs that's actually a
  // list-of-strings ("entity_id: foo"), re-parse it from the raw YAML
  // block as a list-of-maps.
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return frontmatter;
  const fmBlock = m[1];
  // Locate the entity_refs: block and its indented list-of-maps body.
  const refsMatch = fmBlock.match(/^entity_refs:\s*\n((?:[ \t]+.*\n?)+)/m);
  if (!refsMatch) return frontmatter;
  const block = refsMatch[1];
  const refs = [];
  let current = null;
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const itemStart = line.match(/^(\s+)-\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (itemStart) {
      if (current) refs.push(current);
      current = {};
      current[itemStart[2]] = stripQuotes(itemStart[3]);
      continue;
    }
    const cont = line.match(/^\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (cont && current) {
      current[cont[1]] = stripQuotes(cont[2]);
    }
  }
  if (current) refs.push(current);
  if (refs.length > 0) frontmatter.entity_refs = refs;
  return frontmatter;
}

function stripQuotes(s) {
  if (typeof s !== "string") return s;
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

// Classify a path. Returns one of:
//   { kind: "team-entity",  teamSlug, subtypeDir, actionsRoot, entitiesRoot }
//   { kind: "team-action",  teamSlug, actionsRoot }
//   { kind: "view-action",  viewSlug, actionsRoot }
//   null  (out of scope)
function classify(filePath) {
  if (typeof filePath !== "string") return null;
  if (basename(filePath) === "_index.md") return null;
  if (basename(filePath) === "_sources.json") return null;

  const { teamsRoot, leaderViewsRoot } = roots();
  const fp = norm(filePath);

  if (teamsRoot && fp.startsWith(norm(teamsRoot) + "/")) {
    const tail = fp.slice(norm(teamsRoot).length + 1);
    const firstSep = tail.indexOf("/");
    if (firstSep === -1) return null;
    const teamSlug = tail.slice(0, firstSep);
    const teamRoot = join(teamsRoot, teamSlug);
    const entitiesRoot = join(teamRoot, "entities");
    const actionsRoot = join(teamRoot, "actions");
    if (fp.startsWith(norm(entitiesRoot) + "/") && fp.endsWith(".md")) {
      return {
        kind: "team-entity",
        teamSlug,
        subtypeDir: dirname(filePath),
        entitiesRoot,
        actionsRoot,
      };
    }
    if (fp.startsWith(norm(actionsRoot) + "/") && fp.endsWith(".md")) {
      return { kind: "team-action", teamSlug, actionsRoot };
    }
    return null;
  }

  if (leaderViewsRoot && fp.startsWith(norm(leaderViewsRoot) + "/")) {
    const tail = fp.slice(norm(leaderViewsRoot).length + 1);
    const firstSep = tail.indexOf("/");
    if (firstSep === -1) return null;
    const viewSlug = tail.slice(0, firstSep);
    const viewRoot = join(leaderViewsRoot, viewSlug);
    const actionsRoot = join(viewRoot, "actions");
    if (fp.startsWith(norm(actionsRoot) + "/") && fp.endsWith(".md")) {
      return { kind: "view-action", viewSlug, actionsRoot };
    }
    return null;
  }

  return null;
}

function atomicWrite(path, contents) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents, { mode: 0o644 });
  const fd = openSync(tmp, "r");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, path);
}

// Render frontmatter as a small YAML block. Supports scalars, lists, and
// one-level map values (used for trigger_key_index).
function renderFrontmatter(fm) {
  const lines = [];
  for (const [k, v] of Object.entries(fm)) {
    if (v === null || v === undefined) {
      lines.push(`${k}: null`);
    } else if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${JSON.stringify(item)}`);
    } else if (typeof v === "object") {
      lines.push(`${k}:`);
      const entries = Object.entries(v).sort(([a], [b]) => a.localeCompare(b));
      for (const [ik, iv] of entries) {
        lines.push(`  ${JSON.stringify(ik)}: ${JSON.stringify(iv)}`);
      }
    } else if (typeof v === "string") {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.join("\n");
}

function writeIndexAtomic(path, fm, body) {
  fm.updated_at = new Date().toISOString();
  const fmBlock = renderFrontmatter(fm);
  const newContent = `---\n${fmBlock}\n---\n\n${body}\n`;

  // Skip rewrite if only updated_at changed — keeps idempotency tests
  // byte-comparable.
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    const stripTimestamp = (s) =>
      s.replace(/^updated_at: .+$/m, "updated_at: __TS__");
    if (stripTimestamp(existing) === stripTimestamp(newContent)) return;
  }
  atomicWrite(path, newContent);
}

function emitEntityLine(slug, summary) {
  return `- [[${slug}]] — ${summary}`;
}

function emitActionLine(id, fm, summary) {
  const sigils = [
    `@status:${fm.status ?? "unknown"}`,
    `@reason:${fm.reason_class ?? "unknown"}`,
  ];
  if (fm.trigger_key) sigils.push(`@trigger:${fm.trigger_key}`);
  return `- [[${id}]] — ${sigils.join(" ")} — ${summary}`;
}

function deriveSummary(raw, headerHint) {
  // First non-empty line under the named header, falling back to the first
  // non-frontmatter, non-empty body line.
  const { body } = parseFrontmatter(raw);
  const lines = body.split("\n");
  if (headerHint) {
    const headerRegex = new RegExp(`^##\\s+${headerHint}\\s*$`, "i");
    for (let i = 0; i < lines.length; i++) {
      if (headerRegex.test(lines[i])) {
        for (let j = i + 1; j < lines.length; j++) {
          const trimmed = lines[j].trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("##")) break;
          return trimmed.slice(0, 120);
        }
        break;
      }
    }
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("---")) continue;
    if (trimmed.startsWith("#")) continue;
    return trimmed.slice(0, 120);
  }
  return "(no summary)";
}

// Rebuild a single entity-subtype _index.md (e.g.,
// teams/{slug}/entities/people/_index.md).
function rebuildEntitySubtypeIndex(subtypeDir, teamSlug) {
  if (!existsSync(subtypeDir)) return;
  const indexPath = join(subtypeDir, "_index.md");
  const subtype = basename(subtypeDir);
  const lines = [];
  for (const dirent of readdirSync(subtypeDir, { withFileTypes: true })) {
    if (!dirent.isFile()) continue;
    if (!dirent.name.endsWith(".md")) continue;
    if (dirent.name === "_index.md") continue;
    const path = join(subtypeDir, dirent.name);
    const slug = basename(dirent.name, ".md");
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const summary = deriveSummary(raw, "Summary");
    lines.push(emitEntityLine(slug, summary));
  }
  lines.sort();
  const fm = {
    type: "index",
    scope: "team-entities-subtype",
    team_slug: teamSlug,
    parent: `teams/${teamSlug}/entities/${subtype}`,
    entry_count: lines.length,
  };
  writeIndexAtomic(indexPath, fm, lines.join("\n"));
}

// Roll up subtype counts into teams/{slug}/entities/_index.md.
function rebuildEntitiesRollup(entitiesRoot, teamSlug) {
  if (!existsSync(entitiesRoot)) return;
  const subtypes = [];
  for (const dirent of readdirSync(entitiesRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const subIdx = join(entitiesRoot, dirent.name, "_index.md");
    if (!existsSync(subIdx)) continue;
    let count = 0;
    try {
      const { frontmatter } = parseFrontmatter(readFileSync(subIdx, "utf8"));
      count = Number(frontmatter.entry_count) || 0;
    } catch {
      /* skip */
    }
    subtypes.push({ name: dirent.name, count });
  }
  subtypes.sort((a, b) => a.name.localeCompare(b.name));
  const total = subtypes.reduce((s, x) => s + x.count, 0);
  const lines = subtypes.map((s) => `- [[${s.name}]] — ${s.count} entries`);
  const fm = {
    type: "index",
    scope: "team-entities-rollup",
    team_slug: teamSlug,
    parent: `teams/${teamSlug}/entities`,
    entry_count: total,
  };
  writeIndexAtomic(join(entitiesRoot, "_index.md"), fm, lines.join("\n"));
}

// Update teams/{slug}/entities/_sources.json with the changed entity's source
// rows AND the entity_id_index reverse map (used by the lift pass for
// lookup-before-write).
function updateTeamSourcesJson(filePath, fm, entitiesRoot, teamSlug) {
  if (!fm) return;
  const sourcesPath = join(entitiesRoot, "_sources.json");
  let record = {
    version: "1.0.0",
    generated_at: new Date().toISOString(),
    entries: [],
    entity_id_index: {},
  };
  if (existsSync(sourcesPath)) {
    try {
      const parsed = JSON.parse(readFileSync(sourcesPath, "utf8"));
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.entries)) record.entries = parsed.entries;
        if (
          parsed.entity_id_index &&
          typeof parsed.entity_id_index === "object" &&
          !Array.isArray(parsed.entity_id_index)
        ) {
          record.entity_id_index = parsed.entity_id_index;
        }
      }
    } catch {
      /* corrupt — start fresh */
    }
  }

  const slug = fm.id || basename(filePath, ".md");
  const subtype = fm.subtype || basename(dirname(filePath));
  const entityId = typeof fm.entity_id === "string" ? fm.entity_id : null;

  // Maintain entity_id_index reverse map: entity_id → relative-to-entities path.
  if (entityId) {
    const rel = filePath.startsWith(entitiesRoot + sep)
      ? filePath.slice(entitiesRoot.length + 1)
      : filePath;
    record.entity_id_index[entityId] = rel;
  }

  // Build new source entries from the changed file's `sources:` map (mirrors
  // agntux-core's _sources.json shape so the lift pass uses the same lookup
  // contract).
  const newEntries = [];
  if (fm.sources && typeof fm.sources === "object" && !Array.isArray(fm.sources)) {
    for (const [source, value] of Object.entries(fm.sources)) {
      const ids = Array.isArray(value) ? value : [value];
      for (const rawId of ids) {
        if (rawId == null) continue;
        newEntries.push({
          subtype,
          source,
          source_id: String(rawId),
          slug,
          entity_id: entityId,
          team_slug: teamSlug,
        });
      }
    }
  }

  // Upsert: drop colliding triples, drop stale this-slug entries, then merge.
  const filtered = record.entries
    .filter(
      (e) =>
        !newEntries.some(
          (n) =>
            n.subtype === e.subtype &&
            n.source === e.source &&
            n.source_id === e.source_id,
        ),
    )
    .filter((e) => {
      const isThisSlug = e.slug === slug && e.subtype === subtype;
      if (!isThisSlug) return true;
      return newEntries.some((n) => n.source === e.source);
    });

  const merged = [...filtered, ...newEntries].sort((a, b) => {
    if (a.subtype !== b.subtype) return a.subtype.localeCompare(b.subtype);
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.source_id.localeCompare(b.source_id);
  });

  record.entries = merged;
  record.generated_at = new Date().toISOString();

  const tmp = sourcesPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", { mode: 0o644 });
  const fd = openSync(tmp, "r");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, sourcesPath);
}

// Rebuild the actions/_index.md with the trigger_key_index map per P9.
function rebuildActionsIndex(actionsRoot, scope, slug) {
  if (!existsSync(actionsRoot)) return;
  const indexPath = join(actionsRoot, "_index.md");
  const lines = [];
  // trigger_key_index maps trigger_key → list of file basenames (>1 entry
  // signals a duplicate the de-conflict pass merges on the next cycle).
  const triggerKeyIndex = {};

  const entries = [];
  for (const dirent of readdirSync(actionsRoot, { withFileTypes: true })) {
    if (!dirent.isFile()) continue;
    if (!dirent.name.endsWith(".md")) continue;
    if (dirent.name === "_index.md") continue;
    const path = join(actionsRoot, dirent.name);
    const id = basename(dirent.name, ".md");
    let raw, actionFm;
    try {
      raw = readFileSync(path, "utf8");
      actionFm = readFrontmatterWithEntityRefs(raw);
    } catch {
      continue;
    }
    if (!actionFm || !actionFm.status) continue;

    // trigger_key: prefer the file's frontmatter value (validator hook
    // ensures it's the canonical hash), fall back to recomputing from
    // resolveTriggerInputs (defensive — covers stale files).
    let triggerKey =
      typeof actionFm.trigger_key === "string" ? actionFm.trigger_key : null;
    if (!triggerKey) {
      const inputs = resolveTriggerInputs(actionFm);
      if (inputs) {
        try {
          triggerKey = computeTriggerKey(
            inputs.teamSlug,
            inputs.reasonClass,
            inputs.entityIdOrSourceRef,
          );
        } catch {
          triggerKey = null;
        }
      }
    }
    // Exclude `status: superseded` rows from the trigger_key_index so the
    // de-conflict pass doesn't re-fire on already-merged duplicates.
    if (triggerKey && actionFm.status !== "superseded") {
      if (!triggerKeyIndex[triggerKey]) triggerKeyIndex[triggerKey] = [];
      triggerKeyIndex[triggerKey].push(dirent.name);
    }

    const summary = deriveSummary(raw, "Why this matters");
    entries.push({
      id,
      fm: actionFm,
      line: emitActionLine(id, actionFm, summary),
    });
  }

  // Sort: open before closed; within open, by created_at asc.
  entries.sort((a, b) => {
    const sa = a.fm.status === "open" ? 0 : 1;
    const sb = b.fm.status === "open" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return (a.fm.created_at ?? "").localeCompare(b.fm.created_at ?? "");
  });
  for (const e of entries) lines.push(e.line);

  // Sort each trigger_key_index list deterministically.
  for (const key of Object.keys(triggerKeyIndex)) {
    triggerKeyIndex[key].sort();
  }

  const indexFm = {
    type: "index",
    scope: scope === "team" ? "team-actions" : "view-actions",
    parent: scope === "team" ? `teams/${slug}/actions` : `leader-views/${slug}/actions`,
    entry_count: entries.length,
    trigger_key_index: triggerKeyIndex,
  };
  if (scope === "team") indexFm.team_slug = slug;
  if (scope === "view") indexFm.view_slug = slug;

  writeIndexAtomic(indexPath, indexFm, lines.join("\n"));
}

function main() {
  const ctx = readToolContext();
  if (!ctx || (ctx.tool_name !== "Write" && ctx.tool_name !== "Edit")) {
    process.exit(0);
  }
  const filePath = ctx.tool_input?.file_path;
  const c = classify(filePath);
  if (!c) process.exit(0);

  let fm = null;
  if (existsSync(filePath)) {
    try {
      fm = readFrontmatterWithEntityRefs(readFileSync(filePath, "utf8"));
    } catch {
      /* unreadable; rescan still handles index */
    }
  }

  if (c.kind === "team-entity") {
    rebuildEntitySubtypeIndex(c.subtypeDir, c.teamSlug);
    rebuildEntitiesRollup(c.entitiesRoot, c.teamSlug);
    if (fm) updateTeamSourcesJson(filePath, fm, c.entitiesRoot, c.teamSlug);
  } else if (c.kind === "team-action") {
    rebuildActionsIndex(c.actionsRoot, "team", c.teamSlug);
  } else if (c.kind === "view-action") {
    rebuildActionsIndex(c.actionsRoot, "view", c.viewSlug);
  }
  process.exit(0);
}

// Re-export so tests + a future session-end-rebuild hook can do the same passes.
export {
  rebuildEntitySubtypeIndex,
  rebuildEntitiesRollup,
  updateTeamSourcesJson,
  rebuildActionsIndex,
  classify,
};

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

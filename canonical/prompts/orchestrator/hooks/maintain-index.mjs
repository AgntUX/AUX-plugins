#!/usr/bin/env node
// PostToolUse: maintain _index.md files in <agntux project root>/entities/ and
// <agntux project root>/actions/. Path-filtered: exits silently for changes
// outside the project root. Deterministic: regex parsing, no LLM.
// P3 §5.3 + §5.5 are normative. The project root is the nearest ancestor
// directory named `agntux` (case-insensitive), falling back to `~/agntux`.

import { readFileSync, writeFileSync, renameSync, existsSync, fsyncSync, openSync, closeSync, readdirSync } from "node:fs";
import { join, dirname, basename, sep } from "node:path";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { deriveSummary } from "./lib/summary.mjs";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";

const AGNTUX_ROOT = resolveAgntuxRoot();
const ENTITIES_ROOT = AGNTUX_ROOT ? join(AGNTUX_ROOT, "entities") : null;
const ACTIONS_ROOT = AGNTUX_ROOT ? join(AGNTUX_ROOT, "actions") : null;

function readToolContext() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function inScope(filePath) {
  if (typeof filePath !== "string") return null;
  if (!ENTITIES_ROOT || !ACTIONS_ROOT) return null; // no project root resolved
  if (basename(filePath) === "_index.md") return null; // never re-emit on our own writes
  if (filePath.startsWith(ENTITIES_ROOT + sep)) return "entities";
  if (filePath.startsWith(ACTIONS_ROOT + sep)) return "actions";
  return null;
}

function indexPathFor(scope, filePath) {
  if (scope === "actions") return join(ACTIONS_ROOT, "_index.md");
  // For entities: the index lives in the parent subtype dir.
  return join(dirname(filePath), "_index.md");
}

function atomicWrite(path, contents) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents, { mode: 0o644 });
  const fd = openSync(tmp, "r");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, path);
}

function readIndex(path, scope, parent) {
  if (!existsSync(path)) {
    return {
      frontmatter: {
        type: "index",
        scope,
        parent,
        updated_at: new Date().toISOString(),
        entry_count: 0,
      },
      entries: new Map(), // id -> { line }
    };
  }
  const raw = readFileSync(path, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const entries = new Map();
  for (const line of body.split("\n")) {
    if (!line.trim() || !line.startsWith("- ")) continue;
    const m = line.match(/^- \[\[([^\]]+)\]\] — /);
    if (!m) continue;
    entries.set(m[1], { line });
  }
  return { frontmatter, entries };
}

function emitEntityLine(slug, summary) {
  return `- [[${slug}]] — ${summary}`;
}

function emitActionLine(id, fm, summary) {
  const sigils = [`@status:${fm.status}`, `@priority:${fm.priority}`, `@reason:${fm.reason_class}`];
  if (fm.due_by) sigils.push(`@due:${fm.due_by}`);
  return `- [[${id}]] — ${sigils.join(" ")} — ${summary}`;
}

function sortActions(entries) {
  // Read each action's frontmatter for sort keys. Stale-line tolerant.
  const enriched = [];
  for (const [id, e] of entries) {
    const path = join(ACTIONS_ROOT, `${id}.md`);
    let fm = {};
    if (existsSync(path)) {
      try { fm = parseFrontmatter(readFileSync(path, "utf8")).frontmatter; } catch { /* skip */ }
    }
    enriched.push({ id, line: e.line, fm });
  }

  const priorityRank = { high: 0, medium: 1, low: 2 };
  const statusBucket = (s) => {
    if (s === "open" || s === "snoozed") return 0;
    return 1; // done, dismissed
  };

  enriched.sort((a, b) => {
    const sa = statusBucket(a.fm.status);
    const sb = statusBucket(b.fm.status);
    if (sa !== sb) return sa - sb;
    const pa = priorityRank[a.fm.priority] ?? 3;
    const pb = priorityRank[b.fm.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    const da = a.fm.due_by ?? "9999-12-31";
    const db = b.fm.due_by ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    return (a.fm.created_at ?? "") < (b.fm.created_at ?? "") ? -1 : 1;
  });
  return enriched.map((e) => e.line);
}

function writeIndex(path, fm, lines) {
  fm.updated_at = new Date().toISOString();
  fm.entry_count = lines.length;
  const fmYaml = Object.entries(fm).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
  const body = lines.join("\n");
  const newContent = `---\n${fmYaml}\n---\n\n${body}\n`;

  // Skip rename if the body (everything except updated_at) is byte-identical.
  // This prevents spurious re-stamps and keeps idempotency tests byte-comparable.
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    const stripTimestamp = (s) => s.replace(/^updated_at: .+$/m, "updated_at: __TS__");
    if (stripTimestamp(existing) === stripTimestamp(newContent)) return;
  }

  atomicWrite(path, newContent);
}

function bumpRollup() {
  // Re-emit entities/_index.md as a directory-of-directories index.
  // Walks subtype dirs (people/, companies/, projects/, topics/, ...) and reads each
  // subtype's _index.md frontmatter `entry_count` field, summing across subtypes.
  if (!existsSync(ENTITIES_ROOT)) return;
  const subtypes = [];
  for (const name of readdirSync(ENTITIES_ROOT, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const idxPath = join(ENTITIES_ROOT, name.name, "_index.md");
    if (!existsSync(idxPath)) continue;
    let entryCount = 0;
    try {
      const { frontmatter } = parseFrontmatter(readFileSync(idxPath, "utf8"));
      entryCount = Number(frontmatter.entry_count) || 0;
    } catch { /* skip malformed */ }
    subtypes.push({ name: name.name, count: entryCount });
  }
  subtypes.sort((a, b) => a.name.localeCompare(b.name));
  const total = subtypes.reduce((s, x) => s + x.count, 0);
  const lines = subtypes.map(s => `- [[${s.name}]] — ${s.count} entries`);
  const fm = {
    type: "index",
    scope: "entities-rollup",
    parent: "entities",
    updated_at: new Date().toISOString(),
    entry_count: total,
  };
  writeIndex(join(ENTITIES_ROOT, "_index.md"), fm, lines);
}

// Update entities/_sources.json per P3.AMEND.2.
// Reads the frontmatter of the changed entity file and upserts its source entries.
function updateSourcesJson(filePath, fm) {
  if (!fm || !fm.sources || typeof fm.sources !== "object") return;
  if (Array.isArray(fm.sources)) return; // malformed; skip

  const sourcesPath = join(ENTITIES_ROOT, "_sources.json");
  let record = { version: "1.0.0", generated_at: new Date().toISOString(), entries: [] };
  if (existsSync(sourcesPath)) {
    try {
      const parsed = JSON.parse(readFileSync(sourcesPath, "utf8"));
      if (parsed && Array.isArray(parsed.entries)) {
        record = parsed;
      }
    } catch { /* corrupt — start fresh */ }
  }

  const slug = fm.id || basename(filePath, ".md");
  const subtype = fm.subtype || basename(dirname(filePath));

  // Build new entries from this file's sources map.
  const newEntries = [];
  for (const [source, value] of Object.entries(fm.sources)) {
    if (source === "email_domains") continue; // excluded per P3 §3.6.5
    const ids = Array.isArray(value) ? value : [value];
    for (const rawId of ids) {
      if (rawId == null) continue;
      newEntries.push({ subtype, source, source_id: String(rawId), slug });
    }
  }

  // Upsert: remove stale entries for this slug+source combos, then append new ones.
  // Uniqueness invariant: no two entries share (subtype, source, source_id).
  const updatedEntries = record.entries.filter((e) => {
    // Remove entries that would collide with new ones (same subtype+source+source_id).
    return !newEntries.some(
      (n) => n.subtype === e.subtype && n.source === e.source && n.source_id === e.source_id
    );
  });

  // Also remove stale entries for this slug where the source_id may have changed.
  const filteredEntries = updatedEntries.filter((e) => {
    const isThisSlug = e.slug === slug && e.subtype === subtype;
    if (!isThisSlug) return true;
    // Keep only if a matching new entry exists (prevents orphan entries when source_id changes).
    return newEntries.some((n) => n.source === e.source);
  });

  // Merge: add all new entries.
  const merged = [...filteredEntries, ...newEntries];
  // Sort deterministically by (subtype, source, source_id).
  merged.sort((a, b) => {
    if (a.subtype !== b.subtype) return a.subtype.localeCompare(b.subtype);
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.source_id.localeCompare(b.source_id);
  });

  record.entries = merged;
  record.generated_at = new Date().toISOString();

  // Atomic write per P3 §3.6.6.
  const tmp = sourcesPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", { mode: 0o644 });
  const fd = openSync(tmp, "r");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, sourcesPath);
}

function handleEntity(filePath, fm, raw) {
  if (!fm) return; // skip malformed; next valid write repairs the index
  const slug = basename(filePath, ".md");
  const summary = deriveSummary(raw, "Summary");
  const indexPath = indexPathFor("entities", filePath);
  const subtype = basename(dirname(filePath));
  const parent = `entities/${subtype}`;
  const idx = readIndex(indexPath, "entities-subtype", parent);
  idx.entries.set(slug, { line: emitEntityLine(slug, summary) });

  const sortedLines = [...idx.entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, e]) => e.line);

  writeIndex(indexPath, idx.frontmatter, sortedLines);
  bumpRollup(); // keep entities/_index.md in sync (subtype-counts roll-up)
  updateSourcesJson(filePath, fm); // keep _sources.json in sync per P3.AMEND.2
}

function handleAction(filePath, fm, raw) {
  if (!fm || !fm.id || !fm.status) return; // skip malformed; next valid write repairs the index
  const id = basename(filePath, ".md");
  const summary = deriveSummary(raw, "Why this matters");
  const indexPath = indexPathFor("actions", filePath);
  const idx = readIndex(indexPath, "actions", "actions");
  idx.entries.set(id, { line: emitActionLine(id, fm, summary) });

  const sortedLines = sortActions(idx.entries);
  writeIndex(indexPath, idx.frontmatter, sortedLines);
}

function handleDelete(scope, filePath) {
  const id = basename(filePath, ".md");
  const indexPath = indexPathFor(scope, filePath);
  if (!existsSync(indexPath)) return;
  const subtype = scope === "entities" ? basename(dirname(filePath)) : null;
  const parent = scope === "entities" ? `entities/${subtype}` : "actions";
  const idx = readIndex(indexPath, scope === "entities" ? "entities-subtype" : "actions", parent);
  if (!idx.entries.delete(id)) return;
  const lines = scope === "actions"
    ? sortActions(idx.entries)
    : [...idx.entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, e]) => e.line);
  writeIndex(indexPath, idx.frontmatter, lines);
}

function main() {
  const ctx = readToolContext();
  if (!ctx || (ctx.tool_name !== "Write" && ctx.tool_name !== "Edit")) {
    process.exit(0);
  }
  const filePath = ctx.tool_input?.file_path;
  const scope = inScope(filePath);
  if (!scope) process.exit(0);

  // Read the changed source file.
  if (!existsSync(filePath)) {
    // File was deleted (rare — usually tombstoned via deleted_upstream). Remove its line.
    handleDelete(scope, filePath);
    process.exit(0);
  }
  const raw = readFileSync(filePath, "utf8");
  const { frontmatter: fm } = parseFrontmatter(raw);

  if (scope === "entities") {
    handleEntity(filePath, fm, raw);
  } else {
    handleAction(filePath, fm, raw);
  }
  process.exit(0);
}

main();

#!/usr/bin/env node
// PreToolUse: enforce the canonical "Out of scope" hard write-lane taxonomy
// for ingest skills. When an ingest skill is active (any plugin holds a fresh
// lock in `data/learnings/{slug}/sync.md`), Write/Edit operations targeting
// paths outside the permitted lanes are refused with a runbook message —
// the same `kind: out-of-lane-write-attempted: <path>` shape the prompt
// instructs the skill to log on refusal.
//
// Permitted lanes (write OK):
//   <agntux project root>/entities/{subtype}/{slug}.md
//   <agntux project root>/actions/{YYYY-MM-DD}-{slug}.md
//   <agntux project root>/data/learnings/{plugin-slug}/sync.md
//
// Forbidden lanes (refused when an ingest skill is active):
//   <agntux project root>/data/schema/**           (architect Mode B owns)
//   <agntux project root>/data/instructions/**     (`/agntux teach` owns)
//   <agntux project root>/entities/_sources.json   (maintain-index hook owns)
//   <agntux project root>/**/_index.md             (maintain-index hook owns)
//   anywhere else under <agntux project root>/, or outside it
//
// When NO ingest skill is active (no fresh lock anywhere), the hook passes
// through silently — `/agntux schema`, `/agntux teach`, the data architect's
// flows, manual user edits all remain unaffected.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename, sep } from "node:path";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";

const AGNTUX_ROOT = resolveAgntuxRoot();
const ENTITIES_ROOT = AGNTUX_ROOT ? join(AGNTUX_ROOT, "entities") : null;
const ACTIONS_ROOT = AGNTUX_ROOT ? join(AGNTUX_ROOT, "actions") : null;
const LEARNINGS_ROOT = AGNTUX_ROOT ? join(AGNTUX_ROOT, "data", "learnings") : null;
const STALE_LOCK_MS = 60 * 60 * 1000; // 1 hour, matches Step 3's stale-lock window

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
  process.stderr.write(`write-lane-validator: ${reason}\n`);
  process.exit(2);
}

// Which ingest plugin (if any) currently holds a fresh lock?
// Returns the plugin slug, or null when no fresh lock is held anywhere.
function activeIngestPlugin() {
  if (!LEARNINGS_ROOT || !existsSync(LEARNINGS_ROOT)) return null;
  let dirents;
  try {
    dirents = readdirSync(LEARNINGS_ROOT, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const slug = dirent.name;
    const syncMd = join(LEARNINGS_ROOT, slug, "sync.md");
    if (!existsSync(syncMd)) continue;
    let content;
    try {
      content = readFileSync(syncMd, "utf8");
    } catch {
      continue;
    }
    // Match: `- lock: held by <holder> since <RFC 3339>(...)`.
    const m = content.match(/^- lock: held by .+ since (\S+)/m);
    if (!m) continue;
    const since = new Date(m[1]);
    if (!Number.isFinite(+since)) continue;
    if (Date.now() - +since > STALE_LOCK_MS) continue; // stale; ignore
    return slug;
  }
  return null;
}

// Is the file_path in one of the permitted ingest lanes?
function isPermittedLane(filePath, activeSlug) {
  if (typeof filePath !== "string") return false;
  if (!AGNTUX_ROOT) return false;
  // Must be inside the project root.
  if (!filePath.startsWith(AGNTUX_ROOT + sep)) return false;
  const name = basename(filePath);
  // Indexes are hook-owned, never a permitted ingest write.
  if (name === "_index.md") return false;
  if (name === "_sources.json") return false;

  // entities/{subtype}/{slug}.md
  if (
    ENTITIES_ROOT &&
    filePath.startsWith(ENTITIES_ROOT + sep) &&
    filePath.endsWith(".md")
  ) {
    return true;
  }
  // actions/{YYYY-MM-DD}-{slug}.md
  if (
    ACTIONS_ROOT &&
    filePath.startsWith(ACTIONS_ROOT + sep) &&
    filePath.endsWith(".md")
  ) {
    return true;
  }
  // data/learnings/{slug}/sync.md (the ingest plugin's section-of-one).
  if (LEARNINGS_ROOT && filePath.startsWith(LEARNINGS_ROOT + sep)) {
    // Only the active plugin's sync.md (or any sync.md if any ingest is active —
    // we don't enforce slug-match here because a plugin might write helper
    // artefacts in its own `data/learnings/{slug}/` tree in a future iteration).
    return true;
  }
  return false;
}

function main() {
  const ctx = readToolContext();
  if (!ctx) pass();
  if (ctx.tool_name !== "Write" && ctx.tool_name !== "Edit") pass();

  const filePath = ctx.tool_input?.file_path;
  if (typeof filePath !== "string") pass();

  // If no ingest skill is currently active, the hook does not apply —
  // /agntux schema, /agntux teach, manual user edits etc. all flow through.
  const activeSlug = activeIngestPlugin();
  if (!activeSlug) pass();

  // An ingest skill IS active. Apply the hard write-lane taxonomy.
  if (isPermittedLane(filePath, activeSlug)) pass();

  // Not in a permitted lane — refuse and emit a runbook message.
  reject(
    `${activeSlug} attempted to write outside the permitted ingest lanes (\`${filePath}\`). ` +
    `The canonical "Out of scope" rule (reference/sync.md) names three permitted write lanes:\n` +
    `  - <root>/entities/{subtype}/{slug}.md\n` +
    `  - <root>/actions/{YYYY-MM-DD}-{slug}.md\n` +
    `  - <root>/data/learnings/${activeSlug}/sync.md\n` +
    `Append a \`kind: out-of-lane-write-attempted: ${filePath}\` entry to ` +
    `\`data/learnings/${activeSlug}/sync.md\` → errors and continue. ` +
    `Do NOT retry this Write/Edit. ` +
    `If the target is data/schema/, the data architect (\`/agntux schema\`) owns the lock fix; ` +
    `Step 0's exit-clean ladder surfaces the drift to the user. ` +
    `If the target is data/instructions/, \`/agntux teach\` owns the section authoring. ` +
    `If the target is _index.md or _sources.json, agntux-core's PostToolUse hook (\`maintain-index.mjs\`) maintains them — never write directly.`
  );
}

main();

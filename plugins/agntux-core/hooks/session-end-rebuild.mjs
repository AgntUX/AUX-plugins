#!/usr/bin/env node
// SessionEnd / Stop hook: rebuild every entity-subtype index and the actions
// index from scratch. Belt-and-suspenders against drift from manual edits,
// partial writes, or any per-write hook miss. Imports the rescan helpers
// from maintain-index.mjs (which guards its main() so importing doesn't
// re-trigger the per-write path).
//
// Writes a `last_full_rebuild_at` timestamp into the actions/_index.md
// frontmatter so the rebuild is observable. Runs at most once per session
// end — there's no batching here.

import { readFileSync, writeFileSync, renameSync, existsSync, fsyncSync, openSync, closeSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";
import {
  rebuildActionsIndex,
  rebuildEntitySubtypeIndex,
  bumpRollup,
  ACTIONS_ROOT,
  ENTITIES_ROOT,
} from "./maintain-index.mjs";

const AGNTUX_ROOT = resolveAgntuxRoot();

function atomicWrite(path, contents) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents, { mode: 0o644 });
  const fd = openSync(tmp, "r");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, path);
}

function stampLastFullRebuild() {
  if (!ACTIONS_ROOT) return;
  const indexPath = join(ACTIONS_ROOT, "_index.md");
  if (!existsSync(indexPath)) return;
  let content;
  try {
    content = readFileSync(indexPath, "utf8");
  } catch {
    return;
  }
  const stamp = new Date().toISOString();
  // Find the closing `---` of the frontmatter; insert/replace
  // `last_full_rebuild_at:` just before it.
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return;
  let fmBody = fmMatch[1];
  if (/^last_full_rebuild_at:/m.test(fmBody)) {
    fmBody = fmBody.replace(/^last_full_rebuild_at:.*$/m, `last_full_rebuild_at: ${stamp}`);
  } else {
    fmBody = `${fmBody}\nlast_full_rebuild_at: ${stamp}`;
  }
  const rest = content.slice(fmMatch[0].length);
  atomicWrite(indexPath, `---\n${fmBody}\n---\n${rest}`);
}

function main() {
  if (!AGNTUX_ROOT) {
    // No project root resolved — nothing to rebuild. Exit silently
    // (SessionEnd / Stop hooks must be idempotent and side-effect-free in
    // unbootstrapped contexts).
    process.exit(0);
  }

  // Walk every entity subtype directory and rebuild its index.
  if (ENTITIES_ROOT && existsSync(ENTITIES_ROOT)) {
    for (const dirent of readdirSync(ENTITIES_ROOT, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      rebuildEntitySubtypeIndex(join(ENTITIES_ROOT, dirent.name));
    }
    bumpRollup();
  }

  // Rebuild actions index.
  rebuildActionsIndex();

  // Stamp the rebuild timestamp on actions/_index.md.
  stampLastFullRebuild();

  process.exit(0);
}

main();

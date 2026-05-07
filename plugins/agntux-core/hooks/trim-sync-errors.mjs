#!/usr/bin/env node
// PostToolUse: keep <agntux project root>/data/learnings/{slug}/sync.md → errors
// trimmed to the newest 10 entries. Generic across every ingest plugin —
// each `sync.md` is the canonical per-plugin sync-state file specified by
// P3a, and the errors list is the same shape regardless of source.
//
// Why core, not slack/gmail/etc. The trim was previously an agent-side
// instruction in each plugin's SKILL.md — six lines per skill that said
// the same thing, easy to drift out of sync, and burning agent context to
// implement. Centralising in agntux-core means every plugin gets it for
// free and the SKILLs shrink.
//
// Idempotent. If the errors list is already ≤ 10 entries, this hook does
// nothing — no atomic write, no mtime bump. That keeps `git diff` quiet on
// quiet runs and keeps `_index.md`-style PostToolUse fan-out hooks from
// firing on no-op rewrites.
//
// Newest-first convention. The skills authored under canonical/ all
// prepend new entries to the top of the list, so trimming preserves the
// newest 10 by keeping the first 10 entries and dropping the tail.

import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  fsyncSync,
  openSync,
  closeSync,
} from "node:fs";
import { join, basename, dirname, sep } from "node:path";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";

const AGNTUX_ROOT = resolveAgntuxRoot();
const LEARNINGS_ROOT = AGNTUX_ROOT ? join(AGNTUX_ROOT, "data", "learnings") : null;
const ERRORS_KEEP = 10;

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

function inScope(filePath) {
  // Match <root>/data/learnings/<plugin-slug>/sync.md exactly. Hooks fire on
  // any Write/Edit so we filter conservatively — no fancy globbing.
  if (typeof filePath !== "string") return false;
  if (!LEARNINGS_ROOT) return false;
  if (basename(filePath) !== "sync.md") return false;
  if (!filePath.startsWith(LEARNINGS_ROOT + sep)) return false;
  // The slug directory is the immediate parent.
  const parent = dirname(filePath);
  if (dirname(parent) !== LEARNINGS_ROOT) return false;
  return true;
}

// Errors-list shape (per the P3a sync.md template):
//
//   - errors:
//     - kind: <kind> at <ts> — <free-form text on one line>
//     - kind: <kind> at <ts> — ...
//     - ...
//   - lock: null
//
// Each entry is a single `  - kind: ...` line (skills are instructed not to
// emit multi-line entries). The canonical "no errors yet" placeholder is
// `- errors:` followed by a single `  - (none)` line, which we leave alone.
//
// The trim walks the body line-by-line so we can preserve everything around
// the errors block byte-for-byte. We only ever delete trailing entries; we
// never touch frontmatter, the cursor map, lock state, or any other field.
function trimContent(raw) {
  const lines = raw.split("\n");
  const errorsHeaderRe = /^- errors:\s*$/;
  const entryRe = /^  - kind:\s/;
  const placeholderRe = /^  - \(none\)\s*$/;
  const otherTopLevelRe = /^- [a-zA-Z_]/;

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (errorsHeaderRe.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return null; // no errors block — nothing to trim

  // Collect entry indices until the next top-level `- ` line (e.g. `- lock:`).
  const entryIdx = [];
  let endIdx = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (entryRe.test(line)) {
      entryIdx.push(i);
      continue;
    }
    if (placeholderRe.test(line)) continue;
    if (otherTopLevelRe.test(line)) {
      endIdx = i;
      break;
    }
    // Blank lines or unrecognised continuation — pass through; we only trim
    // when there is a clear surplus of `- kind:` entries.
  }

  if (entryIdx.length <= ERRORS_KEEP) return null; // idempotent no-op

  // Keep the newest-first first ERRORS_KEEP, drop the rest. The drop range
  // is from (entryIdx[ERRORS_KEEP]) up to but NOT including the first non-
  // entry/non-placeholder line we tracked (endIdx) — that range is what
  // belongs to the trimmed entries. We DO NOT touch lines >= endIdx.
  const keepUntil = entryIdx[ERRORS_KEEP]; // first line index to drop
  const dropUntil = endIdx; // first line index outside the errors block

  const trimmed = [...lines.slice(0, keepUntil), ...lines.slice(dropUntil)];
  return trimmed.join("\n");
}

function atomicWrite(path, contents) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents, { mode: 0o644 });
  const fd = openSync(tmp, "r");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, path);
}

function main() {
  const ctx = readToolContext();
  if (!ctx) pass();
  const tool = ctx.tool_name;
  if (tool !== "Write" && tool !== "Edit") pass();

  const filePath = ctx.tool_input?.file_path;
  if (!inScope(filePath)) pass();
  if (!existsSync(filePath)) pass(); // file was deleted — nothing to trim

  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    pass();
  }

  const trimmed = trimContent(raw);
  if (trimmed === null) pass(); // no-op
  if (trimmed === raw) pass(); // shouldn't happen, defensive

  try {
    atomicWrite(filePath, trimmed);
  } catch {
    // Don't fail the agent's tool call because trim couldn't acquire the
    // file. The next write will retry.
  }
  pass();
}

main();

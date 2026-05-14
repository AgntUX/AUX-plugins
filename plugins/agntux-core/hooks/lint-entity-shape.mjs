#!/usr/bin/env node
// PreToolUse: lint Write/Edit operations on entity files for deprecated body
// section names. Non-blocking by design — exits 0 even on lint hits, but
// emits an imperative <system-reminder> on stdout so the agent fixes the
// drift in the SAME write rather than completing the run with the
// deprecated name in place.
//
// Path-filtered: only fires for writes inside <agntux project root>/entities/**.
// Anything else passes through silently. The project root is the nearest
// ancestor directory named `agntux` (case-insensitive), falling back to
// `~/agntux`.
//
// Why imperative voice (not suggestion). The transcript that motivated this
// hook had the agent silently working around a SKILL.md/contract mismatch
// over the canonical section name. A soft "consider renaming" reminder gets
// ignored at run-end; a hard "Rename X to Y in this same write before
// completing" gets followed.

import { readFileSync, existsSync } from "node:fs";
import { join, basename, sep } from "node:path";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";
import { resolveScope } from "./lib/scope.mjs";

const AGNTUX_ROOT = resolveAgntuxRoot();
const ENTITIES_ROOT = AGNTUX_ROOT ? join(AGNTUX_ROOT, "entities") : null;

// Deprecated section names → canonical replacement. Add new entries here as
// they're discovered. The replacement is what the contract / instructions
// specify (canonical/prompts/ingest/skills/sync/SKILL.md and the per-plugin
// data/instructions/{slug}.md are the authority).
const DEPRECATED_SECTIONS = [
  {
    deprecated: "## Recent Activity",
    canonical: "## Recent signals",
    reason:
      "data/schema/contracts/agntux-slack.md and data/instructions/agntux-slack.md both specify `## Recent signals` as the canonical name; entity corpus is overwhelmingly on `## Recent signals` (only one outlier was found in 2026-05).",
  },
];

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

function inEntityScope(filePath) {
  // P7 broadens the entity-shape lint to cover team-scoped entities too:
  // <root>/entities/{subtype}/*.md AND <root>/teams/{slug}/entities/{subtype}/*.md.
  // The deprecated-section rules apply identically regardless of scope —
  // the lift pass that authors team copies is supposed to honour the same
  // body-section conventions as the source-plugin lift.
  if (!AGNTUX_ROOT) return false;
  const scope = resolveScope(filePath, AGNTUX_ROOT);
  if (!scope) return false;
  return scope.role === "entity";
}

function readPostWriteContent(ctx) {
  // Mirrors validate-schema.mjs:readContent — derive the post-write file body.
  const input = ctx.tool_input || {};
  if (typeof input.content === "string") return input.content;
  if (typeof input.new_string !== "string") return null;
  if (typeof input.old_string !== "string") return null;
  if (typeof input.file_path !== "string" || !existsSync(input.file_path)) {
    if (input.new_string.startsWith("---\n")) return input.new_string;
    return null;
  }
  try {
    const current = readFileSync(input.file_path, "utf8");
    if (input.replace_all) {
      return current.split(input.old_string).join(input.new_string);
    }
    return current.replace(input.old_string, input.new_string);
  } catch {
    return null;
  }
}

function findHits(content) {
  const hits = [];
  for (const rule of DEPRECATED_SECTIONS) {
    // Match the section header at start-of-line. Tolerate trailing whitespace.
    const re = new RegExp(`^${rule.deprecated.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
    if (re.test(content)) hits.push(rule);
  }
  return hits;
}

function emitReminder(filePath, hits) {
  const fileName = basename(filePath);
  const lines = [
    `entity-shape-lint: ${fileName} contains deprecated body section name${hits.length > 1 ? "s" : ""}.`,
    "",
  ];
  for (const hit of hits) {
    lines.push(
      `Rename \`${hit.deprecated}\` to \`${hit.canonical}\` in this same write before completing — do not finish this run with the deprecated name in place.`
    );
    lines.push(`Why: ${hit.reason}`);
    lines.push("");
  }
  lines.push("This lint is non-blocking — your current write will proceed. Fix the section name in the next Edit so the corpus stays uniform.");
  process.stdout.write(lines.join("\n") + "\n");
}

function main() {
  const ctx = readToolContext();
  if (!ctx) pass();
  const tool = ctx.tool_name;
  if (tool !== "Write" && tool !== "Edit") pass();

  const filePath = ctx.tool_input?.file_path;
  if (!inEntityScope(filePath)) pass();

  const content = readPostWriteContent(ctx);
  if (content === null) pass();

  const hits = findHits(content);
  if (hits.length === 0) pass();

  emitReminder(filePath, hits);
  // Exit 0 — non-blocking. The host treats stdout as additional agent context.
  pass();
}

main();

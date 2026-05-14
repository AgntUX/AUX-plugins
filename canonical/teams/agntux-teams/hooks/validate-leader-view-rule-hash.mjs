#!/usr/bin/env node
// PreToolUse: validate the deterministic `triggered_by_rule_hash` frontmatter
// field on every Write/Edit landing under
//   <agntux project root>/leader-views/{view-slug}/actions/*.md
//
// Mirrors the entity_id + trigger_key validator patterns used elsewhere:
// the LLM authors `triggered_by_rule` (the rule's stable slug as named in
// view-config.md) and `trigger_inputs` (the LLM-composed canonical key string
// for the triggering data); the hook computes
//   expected = sha256(triggered_by_rule + ":" + trigger_inputs).slice(0, 16)
// from those two fields and rejects when the file's `triggered_by_rule_hash`
// is missing or wrong, baking the correct value into the rejection runbook so
// the LLM can self-heal with one Edit. The LLM never computes the hash.
//
// Behavioural rules:
//   - Out-of-scope paths (not under leader-views/{slug}/actions/*.md) → pass.
//   - The hook-owned `_index.md` is excluded — that file is rebuilt by
//     maintain-team-index.mjs and doesn't carry a triggered_by_rule_hash.
//   - Missing tool context → pass.
//   - Non-Write/Edit tool calls → pass.
//   - `tool_input.content` is the candidate frontmatter we validate; if the
//     content is missing (Edit-without-content cases), we fall back to the
//     existing file on disk so an Edit that only rewrites the body still
//     passes.
//   - status: resolved | status: superseded → pass without hash recompute
//     (the LLM is closing out an item; the hash is already canonical).

import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";
import { computeRuleHash, resolveRuleHashInputs } from "./lib/rule-hash.mjs";

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

function rejectLines(lines) {
  process.stderr.write(lines.join("\n") + "\n");
  process.exit(2);
}

function norm(p) {
  if (typeof p !== "string") return p;
  return p.replace(/\\+/g, "/");
}

// Return the leader-view slug for a path under
// <root>/leader-views/{slug}/actions/*.md — or null when the path is
// out-of-scope (not a leader-view action file, sub-directory of actions/, an
// index file, or a non-markdown file).
function viewSlugForActionPath(filePath) {
  if (typeof filePath !== "string") return null;
  const agntuxRoot = resolveAgntuxRoot();
  if (!agntuxRoot) return null;
  const leaderViewsRoot = join(agntuxRoot, "leader-views");
  const fp = norm(filePath);
  const root = norm(leaderViewsRoot);
  if (!fp.startsWith(root + "/")) return null;
  const tail = fp.slice(root.length + 1);
  const firstSep = tail.indexOf("/");
  if (firstSep === -1) return null;
  const viewSlug = tail.slice(0, firstSep);
  const rest = tail.slice(firstSep + 1);
  if (!rest.startsWith("actions/")) return null;
  const fileName = rest.slice("actions/".length);
  // Reject sub-directories under actions/ — only top-level *.md files are
  // valid leader-view action paths. Mirror validate-team-schema.classifyTeamAction.
  if (fileName.length === 0 || fileName.includes("/")) return null;
  if (!fileName.endsWith(".md")) return null;
  if (fileName === "_index.md") return null;
  return viewSlug;
}

// Build the proposed post-write file content. Mirrors validate-team-schema.mjs's
// readContent() so an Edit that rewrites the frontmatter's
// `triggered_by_rule_hash` can't route around this validator by leaving
// `tool_input.content` unset (the host populates content for Write but not for
// Edit). For Write we use `tool_input.content`; for Edit we read the on-disk
// file and apply `old_string` → `new_string` in-memory (respecting
// `replace_all`). Returns null when neither path is reconstructable.
function readContent(ctx) {
  const input = ctx?.tool_input || {};
  if (typeof input.content === "string") return input.content;
  if (typeof input.new_string !== "string") return null;
  if (typeof input.old_string !== "string") return null;
  if (typeof input.file_path !== "string" || !existsSync(input.file_path)) {
    // No on-disk state to merge against — accept full-file replacements only.
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

// Parse the post-write content's frontmatter. Returns null when content is
// missing or has no leading frontmatter block.
function candidateFrontmatter(ctx) {
  const content = readContent(ctx);
  if (typeof content !== "string" || !content.startsWith("---")) return null;
  const { frontmatter } = parseFrontmatter(content);
  return frontmatter ?? null;
}

function emitMissingInputsRunbook(filePath, fm) {
  const lines = [];
  lines.push(
    `leader-view-rule-hash-validator: ${basename(filePath)} is missing the rule-hash inputs.`,
  );
  lines.push("");
  lines.push(
    "Leader-view action items must carry both `triggered_by_rule` (the rule's",
  );
  lines.push(
    "stable slug as authored in view-config.md) and `trigger_inputs` (the",
  );
  lines.push(
    "canonical key string for the triggering data — typically the source",
  );
  lines.push(
    "team_slug + the entity_id or action id, e.g., `customer-success:8f4b2c1d3e5a7b9c`).",
  );
  lines.push(
    "The validator hook computes `triggered_by_rule_hash` from those two fields;",
  );
  lines.push("you never compute the hash yourself.");
  lines.push("");
  lines.push("Runbook (execute this Edit, then retry your blocked Write):");
  lines.push("");
  lines.push(`  1. Edit ${filePath}`);
  lines.push("     Add (or correct) the frontmatter lines so the file carries:");
  lines.push("       triggered_by_rule: <rule-slug-from-view-config.md>");
  lines.push(
    "       trigger_inputs: <canonical-input-string-for-the-triggering-data>",
  );
  lines.push('       triggered_by_rule_hash: ""');
  lines.push("");
  lines.push("  2. Retry your blocked Edit/Write.");
  lines.push("");
  lines.push("Current frontmatter inputs (verify or correct):");
  lines.push(
    `  - triggered_by_rule: ${JSON.stringify(fm?.triggered_by_rule ?? null)}`,
  );
  lines.push(
    `  - trigger_inputs:    ${JSON.stringify(fm?.trigger_inputs ?? null)}`,
  );
  rejectLines(lines);
}

function emitWrongHashRunbook(filePath, fm, expected) {
  const lines = [];
  lines.push(
    `leader-view-rule-hash-validator: ${basename(filePath)} triggered_by_rule_hash is missing or incorrect (expected \`${expected}\`).`,
  );
  lines.push("");
  lines.push(
    "This file's `triggered_by_rule_hash` does not match the deterministic value",
  );
  lines.push(
    "computed from `triggered_by_rule` + `trigger_inputs`. The validator computes",
  );
  lines.push(
    "the hash so every device produces the same value for the same rule fire.",
  );
  lines.push("DO NOT compute the hash yourself — the formula is internal to the hook.");
  lines.push("");
  lines.push("Runbook (execute this Edit, then retry your blocked Write/Edit):");
  lines.push("");
  lines.push(`  1. Edit ${filePath}`);
  if (
    typeof fm?.triggered_by_rule_hash === "string" &&
    fm.triggered_by_rule_hash.length > 0
  ) {
    lines.push(
      `     old_string: triggered_by_rule_hash: ${JSON.stringify(fm.triggered_by_rule_hash)}`,
    );
  } else {
    lines.push(
      "     Add (or correct) the frontmatter line `triggered_by_rule_hash:` so it reads:",
    );
  }
  lines.push(
    `     new_string: triggered_by_rule_hash: ${JSON.stringify(expected)}`,
  );
  lines.push("");
  lines.push("  2. Retry your blocked Edit/Write.");
  lines.push("");
  lines.push("Inputs the validator used (verify these are the canonical key for this rule fire):");
  lines.push(
    `  - triggered_by_rule: ${JSON.stringify(fm?.triggered_by_rule ?? null)}`,
  );
  lines.push(
    `  - trigger_inputs:    ${JSON.stringify(fm?.trigger_inputs ?? null)}`,
  );
  lines.push("");
  lines.push(
    "If `triggered_by_rule` or `trigger_inputs` is wrong, fix those first —",
  );
  lines.push(
    "the hash depends on them and the validator will recompute on retry.",
  );
  rejectLines(lines);
}

function isWellFormedHash(value) {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{16}$/.test(value);
}

// Read the file's current frontmatter from disk. Returns null when the file
// doesn't exist or isn't readable. Used by the status-resolved short-circuit
// to verify the file already carried a canonical hash before we accept a
// status flip.
function diskFrontmatter(filePath) {
  if (typeof filePath !== "string" || !existsSync(filePath)) return null;
  try {
    const { frontmatter } = parseFrontmatter(readFileSync(filePath, "utf8"));
    return frontmatter ?? null;
  } catch {
    return null;
  }
}

// Each branch returns explicitly. process.exit() inside pass() / rejectLines()
// / emit*Runbook() is the canonical termination, but mirror
// validate-team-schema.mjs:277-282 by adding explicit `return;` after every
// terminating call so a test stub that no-ops process.exit can't fall through
// to a later branch.
function main() {
  const ctx = readToolContext();
  if (!ctx) {
    pass();
    return;
  }
  if (ctx.tool_name !== "Write" && ctx.tool_name !== "Edit") {
    pass();
    return;
  }

  const filePath = ctx.tool_input?.file_path;
  const viewSlug = viewSlugForActionPath(filePath);
  if (!viewSlug) {
    pass();
    return;
  }

  const fm = candidateFrontmatter(ctx);
  if (!fm) {
    pass();
    return;
  }

  // Closed-out items (resolved / superseded) keep their canonical hash.
  // Re-validating on a status flip would block a legitimate Edit that doesn't
  // touch the inputs. BUT: a fresh Write with status: resolved and a garbage
  // hash would bypass validation entirely — so the short-circuit only applies
  // when the file already exists on disk AND its on-disk frontmatter carries a
  // well-formed hash that matches the deterministic value. That preserves the
  // legitimate flip-to-resolved use case while closing the initial-write hole.
  if (fm.status === "resolved" || fm.status === "superseded") {
    const onDisk = diskFrontmatter(filePath);
    if (onDisk && isWellFormedHash(onDisk.triggered_by_rule_hash)) {
      const diskInputs = resolveRuleHashInputs(onDisk);
      if (diskInputs) {
        let diskExpected;
        try {
          diskExpected = computeRuleHash(
            diskInputs.ruleSlug,
            diskInputs.triggerInputs,
          );
        } catch {
          diskExpected = null;
        }
        if (diskExpected && onDisk.triggered_by_rule_hash === diskExpected) {
          pass();
          return;
        }
      }
    }
    // Fall through: validate as a fresh write. The wrong-hash / missing-inputs
    // runbook still applies — a new resolved item must carry a valid hash.
  }

  const inputs = resolveRuleHashInputs(fm);
  if (!inputs) {
    emitMissingInputsRunbook(filePath, fm);
    return;
  }

  let expected;
  try {
    expected = computeRuleHash(inputs.ruleSlug, inputs.triggerInputs);
  } catch (e) {
    rejectLines([
      `leader-view-rule-hash-validator: ${basename(filePath)} hash inputs could not be combined: ${e.message}`,
    ]);
    return;
  }

  if (
    isWellFormedHash(fm.triggered_by_rule_hash) &&
    fm.triggered_by_rule_hash === expected
  ) {
    pass();
    return;
  }

  emitWrongHashRunbook(filePath, fm, expected);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export {
  viewSlugForActionPath,
  candidateFrontmatter,
  readContent,
  diskFrontmatter,
  isWellFormedHash,
  emitMissingInputsRunbook,
  emitWrongHashRunbook,
};

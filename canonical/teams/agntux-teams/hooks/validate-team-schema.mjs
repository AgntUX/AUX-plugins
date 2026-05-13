#!/usr/bin/env node
// PreToolUse: validate the hook-computed `trigger_key` on every Write/Edit to
// a team action file (per P9 §"Trigger-key derivation").
//
// Path-filter:
//   - <agntux project root>/teams/{slug}/actions/*.md  → validated.
//   - Anything else (data/, entities/, leader-views/, personal lanes,
//     index files, files outside the agntux project root) → pass-through.
//
// Mirrors the entity_id validator pattern shipped in
// `plugins/agntux-core/hooks/validate-schema.mjs:enforceEntityIdOrReject`:
//
//   1. Parse the proposed file content (the new content for Write; the
//      pre-edit content with the edit applied in-memory for Edit — same
//      `readContent` shape the agntux-core validator uses).
//   2. Resolve `team_slug`, `reason_class`, and
//      `entity_refs[0].entity_id` (falling back to `source_ref`) via the
//      byte-frozen `resolveTriggerInputs` helper.
//   3. If any input is missing, emit a "shape" runbook telling the LLM
//      which frontmatter fields are required for trigger_key derivation.
//      The validator does NOT compute a partial hash — `validate-schema.mjs`
//      already enforces the universal required-fields set, and this hook
//      is narrowly focused on the trigger_key contract.
//   4. Compute `expected_trigger_key` via the byte-frozen `computeTriggerKey`
//      helper. Compare against the frontmatter `trigger_key`.
//   5. If missing or mismatched, reject with a runbook that quotes the
//      correct value verbatim — the LLM never invokes the hash itself.
//
// Hook exit codes mirror the rest of the team validators:
//   - exit 0 → pass (allow the Write/Edit to proceed).
//   - exit 2 → reject (the host shows stderr to the agent so it can fix
//     the file and retry).
//
// Leader-view actions are NOT validated here — they carry
// `triggered_by_rule_hash` (P7-specced) instead of `trigger_key`. That
// validator lands in a separate hook when the leader-view content rules
// pass needs it.

import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";
import { computeTriggerKey, resolveTriggerInputs } from "./lib/trigger-key.mjs";

const TRIGGER_KEY_RE = /^[0-9a-f]{16}$/;

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
  process.stderr.write(`team-schema-validator: ${reason}\n`);
  process.exit(2);
}

// Normalize a path for prefix comparison. Mirrors validate-team-write-lane.mjs
// so the two hooks classify paths identically.
function norm(p) {
  if (typeof p !== "string") return p;
  return p.replace(/\\+/g, "/");
}

function teamActionRoot() {
  const r = resolveAgntuxRoot();
  return r ? join(r, "teams") : null;
}

// Returns `{ teamSlug }` for paths matching
// `<root>/teams/{slug}/actions/*.md` (excluding `_index.md`). Returns null
// otherwise.
function classifyTeamAction(filePath) {
  if (typeof filePath !== "string") return null;
  const teamsRoot = teamActionRoot();
  if (!teamsRoot) return null;
  const fp = norm(filePath);
  const root = norm(teamsRoot);
  if (!fp.startsWith(root + "/")) return null;
  const tail = fp.slice(root.length + 1);
  const firstSep = tail.indexOf("/");
  if (firstSep === -1) return null;
  const teamSlug = tail.slice(0, firstSep);
  const rest = tail.slice(firstSep + 1);
  if (!rest.startsWith("actions/")) return null;
  const fileName = rest.slice("actions/".length);
  if (fileName.length === 0 || fileName.includes("/")) return null;
  if (fileName === "_index.md") return null;
  if (!fileName.endsWith(".md")) return null;
  return { teamSlug };
}

// Build the proposed post-write file content from the tool input. For Write
// this is `tool_input.content`; for Edit we read the file on disk and apply
// the substitution in-memory. Returns null when we can't determine the new
// content (e.g., Edit on a missing file with no leading frontmatter in
// `new_string`) — the caller treats null as "nothing to validate, pass
// through" so that other hooks (write-lane, schema validator) emit the
// canonical error.
function readContent(ctx) {
  const input = ctx.tool_input || {};
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

// The byte-frozen `parseFrontmatter` returns scalar/list/one-level-map fields
// but does not understand the team-action `entity_refs:` list-of-maps shape.
// We replicate the same augmentation `maintain-team-index.mjs` uses so the
// validator agrees byte-for-byte on what feeds `resolveTriggerInputs`.
function readFrontmatterWithEntityRefs(raw) {
  const { frontmatter } = parseFrontmatter(raw);
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return frontmatter;
  const fmBlock = m[1];
  const refsMatch = fmBlock.match(/^entity_refs:\s*\n((?:[ \t]+.*\n?)+)/m);
  if (!refsMatch) return frontmatter;
  const block = refsMatch[1];
  const refs = [];
  let current = null;
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const itemStart = line.match(
      /^(\s+)-\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/,
    );
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

function rejectWithShapeRunbook(filePath, fm) {
  // The trigger_key inputs (team_slug, reason_class, entity_refs[0].entity_id
  // OR source_ref) are missing. Surface a runbook that enumerates the missing
  // fields so the LLM can fill them and retry. `validate-schema.mjs` may also
  // be enforcing universal required-fields; this runbook is the
  // trigger_key-specific complement (and points at the same fields when they
  // overlap, which is fine — the LLM only sees one rejection at a time).
  const lines = [];
  lines.push(
    `team-schema-validator: ${basename(filePath)} cannot compute trigger_key — frontmatter is missing required inputs.`,
  );
  lines.push("");
  lines.push(
    "Per P9, trigger_key is derived deterministically from three frontmatter values:",
  );
  lines.push("");
  lines.push(
    `  - team_slug:   ${fm && typeof fm.team_slug === "string" && fm.team_slug ? JSON.stringify(fm.team_slug) : "MISSING — set to the team's directory key"}`,
  );
  lines.push(
    `  - reason_class: ${fm && typeof fm.reason_class === "string" && fm.reason_class ? JSON.stringify(fm.reason_class) : "MISSING — set to one of the team's declared reason_class values"}`,
  );
  const refs = fm && Array.isArray(fm.entity_refs) ? fm.entity_refs : null;
  const firstEntityId =
    refs && refs.length > 0 && typeof refs[0]?.entity_id === "string"
      ? refs[0].entity_id
      : null;
  const sourceRef =
    fm && typeof fm.source_ref === "string" ? fm.source_ref : null;
  if (firstEntityId) {
    lines.push(`  - entity_refs[0].entity_id: ${JSON.stringify(firstEntityId)}`);
  } else if (sourceRef) {
    lines.push(`  - source_ref:               ${JSON.stringify(sourceRef)}`);
  } else {
    lines.push(
      "  - entity_refs[0].entity_id OR source_ref: MISSING — set one of these to identify the trigger's subject",
    );
  }
  lines.push("");
  lines.push(
    "Add the missing frontmatter field(s), leave `trigger_key: \"\"` blank, then retry. The validator",
  );
  lines.push(
    "will compute the correct trigger_key and surface it via the runbook on the next attempt.",
  );

  process.stderr.write(lines.join("\n") + "\n");
  process.exit(2);
}

function rejectWithTriggerKeyRunbook(filePath, fm, expected) {
  const lines = [];
  const actual = typeof fm.trigger_key === "string" ? fm.trigger_key : null;
  lines.push(
    `team-schema-validator: ${basename(filePath)} trigger_key is missing or incorrect (expected \`${expected}\`)`,
  );
  lines.push("");
  lines.push(
    "This team-action file's `trigger_key` does not match the deterministic value computed",
  );
  lines.push(
    "from `team_slug` + `reason_class` + `entity_refs[0].entity_id` (or `source_ref` when",
  );
  lines.push(
    "no entity ref is present). The validator computes trigger_key so every device produces",
  );
  lines.push(
    "the same value for the same logical trigger — DO NOT compute the hash yourself.",
  );
  lines.push("");
  lines.push("Runbook (execute this Edit, then retry your blocked Write/Edit):");
  lines.push("");
  lines.push(`  1. Edit ${filePath}`);
  if (actual !== null && actual.length > 0) {
    lines.push(`     old_string: trigger_key: ${JSON.stringify(actual)}`);
  } else {
    lines.push(
      "     Add (or correct) the frontmatter line `trigger_key:` so it reads:",
    );
  }
  lines.push(`     new_string: trigger_key: ${JSON.stringify(expected)}`);
  lines.push("");
  lines.push("  2. Retry your blocked Edit/Write.");
  lines.push("");
  lines.push(
    "Inputs the validator used (verify these are the natural key for this trigger):",
  );
  lines.push(`  - team_slug:    ${JSON.stringify(fm.team_slug)}`);
  lines.push(`  - reason_class: ${JSON.stringify(fm.reason_class)}`);
  const refs = Array.isArray(fm.entity_refs) ? fm.entity_refs : null;
  if (refs && refs.length > 0 && typeof refs[0]?.entity_id === "string") {
    lines.push(
      `  - entity_refs[0].entity_id: ${JSON.stringify(refs[0].entity_id)}`,
    );
  } else if (typeof fm.source_ref === "string") {
    lines.push(`  - source_ref:   ${JSON.stringify(fm.source_ref)}`);
  }
  lines.push("");
  lines.push(
    "If any of those inputs is wrong (not the trigger_key), fix that first — the",
  );
  lines.push("trigger_key depends on them and the validator will recompute on retry.");

  process.stderr.write(lines.join("\n") + "\n");
  process.exit(2);
}

function main() {
  // `pass()`, `reject()`, `rejectWithShapeRunbook()`, and
  // `rejectWithTriggerKeyRunbook()` all terminate via `process.exit()` — they
  // never return. We still add explicit `return;` after each call so a future
  // refactor (e.g., swapping `process.exit` for a test-friendly throw) can't
  // silently fall through into a dereference of a possibly-null `content` or
  // `inputs`. The dead-code is intentional belt-and-suspenders.
  const ctx = readToolContext();
  if (!ctx) { pass(); return; }
  if (ctx.tool_name !== "Write" && ctx.tool_name !== "Edit") { pass(); return; }

  const filePath = ctx.tool_input?.file_path;
  const c = classifyTeamAction(filePath);
  if (!c) { pass(); return; }

  const content = readContent(ctx);
  if (content === null) {
    // Body-only edit we can't reconstruct — defer; the hook is not the only
    // gate (validate-schema.mjs still runs and post-write maintain-team-index
    // picks up the index update on success).
    pass();
    return;
  }

  let fm;
  try {
    fm = readFrontmatterWithEntityRefs(content);
  } catch {
    reject(`could not parse frontmatter in ${basename(filePath)}`);
    return;
  }
  if (!fm || Object.keys(fm).length === 0) {
    reject(`${basename(filePath)} is missing YAML frontmatter`);
    return;
  }

  const inputs = resolveTriggerInputs(fm);
  if (!inputs) {
    rejectWithShapeRunbook(filePath, fm);
    return;
  }

  let expected;
  try {
    expected = computeTriggerKey(
      inputs.teamSlug,
      inputs.reasonClass,
      inputs.entityIdOrSourceRef,
    );
  } catch (e) {
    // Defensive — resolveTriggerInputs returned non-null, so all three inputs
    // should be non-empty strings. If we get here, surface the underlying
    // helper error verbatim.
    reject(
      `${basename(filePath)} trigger_key cannot be computed: ${e.message}`,
    );
    return;
  }

  const actual = typeof fm.trigger_key === "string" ? fm.trigger_key : "";
  if (TRIGGER_KEY_RE.test(actual) && actual === expected) {
    pass();
    return;
  }

  rejectWithTriggerKeyRunbook(filePath, fm, expected);
}

// Re-export pure helpers so tests can drive them directly without spawning the
// hook as a child process for every assertion.
export { classifyTeamAction, readFrontmatterWithEntityRefs };

// Only invoke main() when this file is run as a script (the hook entry
// point). Test imports must not trigger main() — it reads stdin and calls
// process.exit(), which would break the test runner.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

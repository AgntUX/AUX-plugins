#!/usr/bin/env node
// PreToolUse: validate Write/Edit operations against the user's tenant schema (P3a §3).
//
// Path-filtered: only fires for writes inside <agntux project root>/entities/**
// or <agntux project root>/actions/**. Anything else — including
// <root>/data/schema/, <root>/data/instructions/, <root>/data/learnings/,
// <root>/data/schema-warnings.md, <root>/data/schema-requests.md,
// <root>/user.md — is passed through unchanged. The project root is the nearest
// ancestor directory named `agntux` (case-insensitive), falling back to
// `~/agntux`.
//
// Reads <root>/data/schema/schema.lock.json (cached for 2s). Verifies:
//   1. Frontmatter is parseable.
//   2. Required fields per schema (subtype-specific + the universal set).
//   3. `subtype` is in the lock's entity_subtypes AND in the writing plugin's
//      allowed_subtypes.
//   4. For actions: `reason_class` is in lock.action_classes AND in the
//      plugin's allowed_action_classes.
//   5. `schema_version` matches the writing plugin's contract version.
//   6. Slug rules (P3 §2.4): lowercase, NFKD-stripped, hyphenated, ≤64 chars.
//
// Identifying the writing plugin (in priority order):
//   1. Hook event payload's `plugin` field (canonical hook bundle convention).
//   2. Frontmatter `source` (e.g., `source: slack` → look up `agntux-slack`).
//   3. None — block with a clear error.
//
// On rejection, exits with code 2 and writes a one-line reason to stderr;
// the host shows it to the agent so it can correct and retry.

import { readFileSync, existsSync } from "node:fs";
import { join, basename, dirname, sep } from "node:path";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { readSchemaLock, checkSubtypeAllowed, checkActionClassAllowed } from "./lib/schema-lock.mjs";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";

const AGNTUX_ROOT = resolveAgntuxRoot();
const ENTITIES_ROOT = AGNTUX_ROOT ? join(AGNTUX_ROOT, "entities") : null;
const ACTIONS_ROOT = AGNTUX_ROOT ? join(AGNTUX_ROOT, "actions") : null;
const CONTRACTS_DIR = AGNTUX_ROOT ? join(AGNTUX_ROOT, "data", "schema", "contracts") : null;

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const SOURCE_TO_PLUGIN_RE = /^[a-z][a-z0-9-]*$/;

function readToolContext() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function reject(reason) {
  process.stderr.write(`schema-validator: ${reason}\n`);
  process.exit(2);
}

function pass() {
  process.exit(0);
}

function inScope(filePath) {
  if (typeof filePath !== "string") return null;
  if (!ENTITIES_ROOT || !ACTIONS_ROOT) return null; // no project root resolved
  if (basename(filePath) === "_index.md") return null; // index files are hook-managed, not agent-written
  if (filePath.startsWith(ENTITIES_ROOT + sep)) return "entity";
  if (filePath.startsWith(ACTIONS_ROOT + sep)) return "action";
  return null;
}

function sourceTokenToSlug(token) {
  // Three-branch ladder; ORDER MATTERS:
  //   1. `agntux-*`      → verbatim. MUST come before branch 2 because a
  //                        future plugin slug `agntux-foo-ingest` would
  //                        match both branches; the prefix wins.
  //   2. `*-ingest`      → verbatim. Legacy slugs (slack-ingest, notes-ingest)
  //                        accepted during the migration window so pre-rename
  //                        entity files keep validating against their contract.
  //                        New plugins MUST use the `agntux-` prefix; this
  //                        branch is for backward compat only.
  //   3. bare `<source>` → `agntux-<source>`. The convention.
  if (typeof token !== "string" || !SOURCE_TO_PLUGIN_RE.test(token)) return null;
  if (token.startsWith("agntux-")) return token;
  if (token.endsWith("-ingest")) return token;
  return `agntux-${token}`;
}

function resolvePluginSlug(ctx, fm) {
  // Priority 1: hook event payload (canonical hook bundle convention).
  const fromHook = ctx?.plugin || ctx?.hook_event?.plugin || ctx?.event?.plugin;
  const fromHookSlug = sourceTokenToSlug(fromHook);
  if (fromHookSlug) return fromHookSlug;

  // Priority 2: action-item frontmatter `source` (e.g., `slack` → `agntux-slack`).
  const fromSource = sourceTokenToSlug(fm?.source);
  if (fromSource) return fromSource;

  // Priority 3: entity frontmatter `sources` map. When there's exactly one
  // source key, that key identifies the writing plugin. Multiple keys means
  // the entity has been touched by more than one plugin — fall through to
  // null (no plugin-contract check, but the schema-level enum check still runs).
  if (fm && fm.sources && typeof fm.sources === "object" && !Array.isArray(fm.sources)) {
    const keys = Object.keys(fm.sources).filter((k) => k !== "email_domains");
    if (keys.length === 1) {
      const slug = sourceTokenToSlug(keys[0]);
      if (slug) return slug;
    }
  }

  return null;
}

function checkRequiredEntityFrontmatter(fm) {
  const required = [
    "id",
    "type",
    "schema_version",
    "subtype",
    "aliases",
    "sources",
    "created_at",
    "updated_at",
    "last_active",
    "deleted_upstream",
  ];
  for (const field of required) {
    if (!(field in fm)) return field;
  }
  if (fm.type !== "entity") return "type (must equal `entity`)";
  return null;
}

function checkRequiredActionFrontmatter(fm) {
  const required = [
    "id",
    "type",
    "schema_version",
    "status",
    "priority",
    "reason_class",
    "created_at",
    "source",
    "source_ref",
    "related_entities",
    "suggested_actions",
  ];
  for (const field of required) {
    if (!(field in fm)) return field;
  }
  if (fm.type !== "action-item") return "type (must equal `action-item`)";
  if (!["open", "snoozed", "done", "dismissed"].includes(fm.status)) {
    return "status (must be one of: open, snoozed, done, dismissed)";
  }
  if (!["high", "medium", "low"].includes(fm.priority)) {
    return "priority (must be one of: high, medium, low)";
  }
  if (fm.reason_class === "other" && !fm.reason_detail) {
    return "reason_detail (required when reason_class is `other`)";
  }
  return null;
}

function checkSlug(slug) {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 64) return false;
  return SLUG_RE.test(slug);
}

function readContent(ctx) {
  // PreToolUse runs BEFORE the write, so the file on disk reflects pre-edit
  // state. We compute what the post-write content WILL be:
  //   - Write: tool_input.content is the full new file body.
  //   - Edit: read disk, apply old_string→new_string in memory.
  //   - Edit with replace_all: apply replaceAll instead of single replace.
  //
  // Returning null tells the caller "can't determine new content" — e.g., a
  // body-only edit on a missing file (which would fail at the Write stage
  // anyway). The validator passes through in that case.
  const input = ctx.tool_input || {};
  if (typeof input.content === "string") return input.content;
  if (typeof input.new_string !== "string") return null;
  if (typeof input.old_string !== "string") return null;
  if (typeof input.file_path !== "string" || !existsSync(input.file_path)) {
    // No disk state to merge against — best we can do is validate the new
    // frontmatter alone if it looks like a full-file replacement.
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

function main() {
  const ctx = readToolContext();
  if (!ctx) pass(); // no payload → not our job
  const tool = ctx.tool_name;
  if (tool !== "Write" && tool !== "Edit") pass();

  const filePath = ctx.tool_input?.file_path;
  const scope = inScope(filePath);
  if (!scope) pass();

  // Read the lock once. If absent (no schema bootstrapped yet), pass through
  // — the user is in pre-bootstrap state and the architect will set things up.
  let lock;
  try {
    lock = readSchemaLock();
  } catch (e) {
    reject(`schema.lock.json is unreadable: ${e.message}. Run \`/ux schema review\` to regenerate.`);
  }
  if (!lock) pass();

  const content = readContent(ctx);
  if (content === null) {
    // Edit on a body-only line that doesn't change frontmatter — pass.
    pass();
  }

  let fm;
  try {
    fm = parseFrontmatter(content).frontmatter;
  } catch {
    reject(`could not parse frontmatter in ${basename(filePath)}`);
  }
  if (!fm || Object.keys(fm).length === 0) {
    reject(`${basename(filePath)} is missing YAML frontmatter`);
  }

  // Resolve plugin slug.
  const pluginSlug = resolvePluginSlug(ctx, fm);

  // Late-install runbook: contract markdown sits at status: approved but
  // the lock hasn't yet registered the plugin under plugin_contracts. The
  // 2026-05-07 agntux-gmail incident hit exactly this — Mode B never ran
  // for the late-installed plugin, so the validator rejected every action
  // write with the generic "no approved contract" message. Detect the
  // condition here and emit a runbook the agent can execute, instead of
  // the generic rejection.
  if (pluginSlug && pluginSlug !== "agntux-core") {
    const registered = lock.plugin_contracts && lock.plugin_contracts[pluginSlug];
    if (!registered) {
      const approved = readApprovedContractFrontmatter(pluginSlug);
      if (approved) {
        rejectWithMissingContractRunbook(filePath, pluginSlug, approved);
      }
    }
  }

  if (scope === "entity") {
    const missing = checkRequiredEntityFrontmatter(fm);
    if (missing) reject(`${basename(filePath)} missing required frontmatter field: ${missing}`);

    if (!checkSlug(fm.id)) reject(`${basename(filePath)} has invalid slug \`${fm.id}\` (must be lowercase, hyphenated, ≤64 chars)`);
    // Directory-name vs subtype is intentionally NOT checked: subtype dirs may
    // be plural (people, companies), singular, or irregular; the schema contract
    // is the authority on subtype membership, not the directory name.

    const check = checkSubtypeAllowed(lock, pluginSlug, fm.subtype);
    if (!check.ok) reject(check.reason);
  } else if (scope === "action") {
    const missing = checkRequiredActionFrontmatter(fm);
    if (missing) reject(`${basename(filePath)} missing required frontmatter field: ${missing}`);

    if (!checkSlug(fm.id.replace(/^\d{4}-\d{2}-\d{2}-/, ""))) {
      reject(`${basename(filePath)} has invalid slug-suffix in id \`${fm.id}\``);
    }

    const check = checkActionClassAllowed(lock, pluginSlug, fm.reason_class);
    if (!check.ok) reject(check.reason);
  }

  // schema_version match against the plugin's contract — but only for the
  // owning ingest plugin (orchestrator-driven edits inherit the file's existing
  // version, which may legitimately predate a recent contract bump).
  //
  // The match is semver-aware:
  //   - PATCH drift in either direction → pass silently. Patch bumps are
  //     no-surface changes (typo fixes, README copy) and never break files.
  //   - MINOR drift, file ahead of contract (e.g. file=1.1.0, contract=1.0.0)
  //     → reject + emit a runbook the agent can execute to bump the contract.
  //     This is the case the 2026-05-07 sync run hit: the file corpus carried
  //     1.1.0 because of additive `## Compose payload` body sections, but the
  //     contract was still at 1.0.0. The agent silently DOWNGRADED the file
  //     (the wrong direction — corrupts historical records). The runbook below
  //     fixes the contract instead.
  //   - MINOR drift, file behind contract (file=1.0.0, contract=1.1.0)
  //     → pass silently. Existing files predating an additive contract bump
  //     are correct as-is; nothing to rewrite.
  //   - MAJOR drift in either direction → reject + emit a runbook AND require
  //     the agent to surface the change to the user before retrying. Major
  //     bumps shouldn't auto-heal — they need acknowledgment.
  if (pluginSlug && pluginSlug !== "agntux-core") {
    const contract = lock.plugin_contracts[pluginSlug];
    if (contract && contract.schema_version && fm.schema_version !== contract.schema_version) {
      const result = checkSchemaVersionDrift(fm.schema_version, contract.schema_version);
      if (result.kind !== "ok") {
        rejectWithRunbook(filePath, fm.schema_version, contract.schema_version, pluginSlug, result);
      }
    }
  }

  pass();
}

// -----------------------------------------------------------------------------
// Semver-aware schema_version drift detection + runbook emission.
//
// `parseSemver` returns null on unparseable strings; the caller treats that as
// "exact-match required" (the original `===` behaviour) so a malformed version
// can't slip through pretending to be a patch difference.
// -----------------------------------------------------------------------------

function parseSemver(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

function checkSchemaVersionDrift(fileVer, contractVer) {
  const f = parseSemver(fileVer);
  const c = parseSemver(contractVer);
  if (!f || !c) {
    // Unparseable on either side — fall back to strict mismatch; emit the
    // legacy reject text so old-style errors remain greppable.
    return { kind: "unparseable" };
  }
  if (f.major !== c.major) {
    const direction = f.major > c.major ? "file-ahead" : "contract-ahead";
    return { kind: "major", direction };
  }
  if (f.minor !== c.minor) {
    const direction = f.minor > c.minor ? "file-ahead" : "contract-ahead";
    // Contract-ahead minor drift is the "existing files predate an additive
    // bump" case — pass silently.
    if (direction === "contract-ahead") return { kind: "ok" };
    return { kind: "minor", direction };
  }
  // Patch drift in either direction — silently tolerate.
  return { kind: "ok" };
}

function rejectWithRunbook(filePath, fileVer, contractVer, pluginSlug, result) {
  const fileName = basename(filePath);
  const contractMdRel = `data/schema/contracts/${pluginSlug}.md`;
  const lockJsonRel = `data/schema/schema.lock.json`;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  if (result.kind === "unparseable") {
    reject(
      `${fileName} schema_version \`${fileVer}\` does not match \`${pluginSlug}\` contract version \`${contractVer}\`. Both versions must be parseable as MAJOR.MINOR.PATCH. Fix the malformed version in the file or the contract markdown / schema.lock.json before retrying.`
    );
  }

  const lines = [];
  lines.push(`schema-validator: schema_version mismatch (file=${fileVer}, contract=${contractVer})`);
  lines.push("");

  if (result.kind === "minor" && result.direction === "file-ahead") {
    lines.push(`The contract at ${contractMdRel} is OUT OF DATE relative to the file corpus.`);
    lines.push(`DO NOT downgrade ${fileName} — that corrupts historical records.`);
    lines.push("");
    lines.push("Runbook (execute these Edit operations, then retry your original write):");
    lines.push("");
    lines.push(`  1. Edit <agntux project root>/${contractMdRel}`);
    lines.push(`     old_string: schema_version: "${contractVer}"`);
    lines.push(`     new_string: schema_version: "${fileVer}"`);
    lines.push("");
    lines.push(`  2. Edit <agntux project root>/${contractMdRel}`);
    lines.push(`     Bump the frontmatter \`updated_at\` field to ${today}.`);
    lines.push("");
    lines.push(`  3. Edit <agntux project root>/${contractMdRel}`);
    lines.push(`     Append (or extend) a \`## Version history\` body section with one line:`);
    lines.push(`       - ${fileVer} (${today}) — bumped to match action/entity corpus.`);
    lines.push("");
    lines.push(`  4. Edit <agntux project root>/${lockJsonRel}`);
    lines.push(`     In plugin_contracts.${pluginSlug}.schema_version, change "${contractVer}" → "${fileVer}".`);
    lines.push(`     This is what the validator actually reads on the next retry.`);
    lines.push("");
    lines.push("  5. Retry your blocked Edit/Write.");
    lines.push("");
    lines.push(`If you suspect the file is wrong (not the contract), stop and surface the mismatch to the user — do not silently downgrade the file.`);
  } else if (result.kind === "major") {
    const direction =
      result.direction === "file-ahead"
        ? "the file corpus has moved past a major boundary that the contract has not been refreshed for"
        : "the contract has been bumped past a major boundary that this file has not been migrated for";
    lines.push(`MAJOR-version drift — ${direction}.`);
    lines.push("Major bumps are NOT auto-healable. They almost always mean a breaking shape change");
    lines.push("(removed required field, retired enum value, restructured body sections) and must be");
    lines.push("acknowledged explicitly before any rewrite.");
    lines.push("");
    lines.push("Runbook (DO NOT execute step-by-step without first surfacing this to the user):");
    lines.push("");
    lines.push(`  1. STOP and surface to the user, verbatim:`);
    lines.push(`       \"${pluginSlug} schema_version drift detected: file=${fileVer}, contract=${contractVer}.`);
    lines.push(`        This is a MAJOR bump and may be a breaking shape change. Should I:`);
    lines.push(`         (a) bump the contract to match the file (file is canonical), or`);
    lines.push(`         (b) migrate this file forward to match the contract (contract is canonical), or`);
    lines.push(`         (c) something else?\"`);
    lines.push("");
    lines.push("  2. Wait for the user's answer. Do not execute any Edit until they reply.");
    lines.push("");
    lines.push("  3. Once direction is chosen:");
    lines.push(`     - Path (a): Bump ${contractMdRel} schema_version + updated_at, append a`);
    lines.push(`       \`## Breaking changes\` body section enumerating what changed at the major`);
    lines.push(`       boundary, then bump ${lockJsonRel} plugin_contracts.${pluginSlug}.schema_version.`);
    lines.push(`     - Path (b): rewrite the file's body to match the new contract shape, then`);
    lines.push(`       bump the file's frontmatter schema_version to ${contractVer}.`);
    lines.push(`     - Path (c): follow the user's instructions.`);
    lines.push("");
    lines.push("  4. Retry your blocked Edit/Write.");
  } else {
    // Defensive — minor contract-ahead is filtered out earlier; this branch
    // shouldn't fire. Leave a tight one-liner just in case.
    reject(
      `${fileName} schema_version \`${fileVer}\` does not match \`${pluginSlug}\` contract version \`${contractVer}\`.`
    );
  }

  process.stderr.write(lines.join("\n") + "\n");
  process.exit(2);
}

// -----------------------------------------------------------------------------
// Late-install missing-contract detection.
//
// Returns the contract markdown's frontmatter when:
//   - The contract file exists at <root>/data/schema/contracts/<slug>.md, AND
//   - The frontmatter has `status: approved`.
// Returns null otherwise (the existing generic rejection path is correct in
// that case — the contract genuinely isn't approved yet).
// -----------------------------------------------------------------------------

function readApprovedContractFrontmatter(pluginSlug) {
  if (!CONTRACTS_DIR) return null;
  const contractPath = join(CONTRACTS_DIR, `${pluginSlug}.md`);
  if (!existsSync(contractPath)) return null;
  let raw;
  try {
    raw = readFileSync(contractPath, "utf8");
  } catch {
    return null;
  }
  let fm;
  try {
    fm = parseFrontmatter(raw).frontmatter;
  } catch {
    return null;
  }
  if (!fm || fm.status !== "approved") return null;
  return fm;
}

function rejectWithMissingContractRunbook(filePath, pluginSlug, approvedFm) {
  const contractMdRel = `data/schema/contracts/${pluginSlug}.md`;
  const lockJsonRel = `data/schema/schema.lock.json`;
  const nowIso = new Date().toISOString();
  const schemaVersion = approvedFm.schema_version || "1.0.0";
  const sourceIdFormat = approvedFm.source_id_format || null;

  // The Mode B template authors contracts with "# Allowed entity subtypes" /
  // "# Allowed action classes" body sections, but historic / hand-authored
  // contracts (e.g., the agntux-gmail incident that motivated this runbook)
  // use variants like "## Owned subtypes" / "## Action_class usage". The
  // runbook leaves section-name discovery to the agent rather than
  // prescribing one form — every approved contract surfaces the same data
  // somewhere in the body, regardless of heading convention.
  const lockEntryLines = [
    `       "${pluginSlug}": {`,
    `         "schema_version": "${schemaVersion}",`,
    `         "allowed_subtypes": [<list from step 1>],`,
    `         "allowed_action_classes": [<list from step 1>],`,
  ];
  if (sourceIdFormat) {
    lockEntryLines.push(`         "approved_at": "${nowIso}",`);
    lockEntryLines.push(`         "source_id_format": ${JSON.stringify(sourceIdFormat)}`);
  } else {
    lockEntryLines.push(`         "approved_at": "${nowIso}"`);
  }
  lockEntryLines.push(`       }`);

  const lines = [
    `schema-validator: plugin_contracts["${pluginSlug}"] missing from schema.lock.json`,
    "",
    `The contract markdown at ${contractMdRel} is status: approved, but the lock`,
    `file does not yet register the plugin. This usually means ${pluginSlug} was`,
    `installed after /agntux-onboard last ran data-architect Mode B.`,
    "",
    "Runbook (execute these Edit operations, then retry your blocked write):",
    "",
    `  1. Read <agntux project root>/${contractMdRel} and extract:`,
    `       - schema_version (frontmatter): "${schemaVersion}"`,
    `       - allowed_subtypes — the entity subtypes the contract grants this`,
    `         plugin. The Mode B template names this section "# Allowed entity`,
    `         subtypes"; hand-authored contracts may use "## Owned subtypes" or`,
    `         similar. One bullet per subtype regardless.`,
    `       - allowed_action_classes — the action_class values the plugin may`,
    `         write. Look for "# Allowed action classes" or "## Action_class`,
    `         usage" / "## reason_class enum" in the body.`,
  ];
  if (sourceIdFormat) {
    lines.push(`       - source_id_format (frontmatter): ${JSON.stringify(sourceIdFormat)}`);
  }
  lines.push("");
  lines.push(`  2. Edit <agntux project root>/${lockJsonRel} and add a sibling key`);
  lines.push(`     under plugin_contracts:`);
  lines.push("");
  for (const lockLine of lockEntryLines) {
    lines.push(lockLine);
  }
  lines.push("");
  lines.push(`  3. Edit <agntux project root>/${lockJsonRel}`);
  lines.push(`     Bump generated_at to "${nowIso}".`);
  lines.push("");
  lines.push("  4. Retry your blocked Edit/Write.");
  lines.push("");
  lines.push(`If you suspect the contract markdown should NOT yet be approved (e.g. the user`);
  lines.push(`hasn't reviewed the schema), stop and surface this to the user instead — do`);
  lines.push(`not auto-register an unreviewed plugin into the lock.`);

  process.stderr.write(lines.join("\n") + "\n");
  process.exit(2);
}

main();

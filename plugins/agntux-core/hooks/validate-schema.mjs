#!/usr/bin/env node
// PreToolUse: validate Write/Edit operations against the user's tenant schema (P3a §3).
//
// Path-filtered: only fires for writes inside ~/agntux-code/entities/** or ~/agntux-code/actions/**.
// Anything else — including ~/agntux-code/data/schema/, ~/agntux-code/data/instructions/,
// ~/agntux-code/data/learnings/, ~/agntux-code/data/schema-warnings.md,
// ~/agntux-code/data/schema-requests.md, ~/agntux-code/user.md — is passed through unchanged.
//
// Reads ~/agntux-code/data/schema/schema.lock.json (cached for 2s). Verifies:
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
//   2. Frontmatter `source` (e.g., `source: notes` → look up `notes-ingest`).
//   3. None — block with a clear error.
//
// On rejection, exits with code 2 and writes a one-line reason to stderr;
// the host shows it to the agent so it can correct and retry.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, dirname, sep } from "node:path";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { readSchemaLock, checkSubtypeAllowed, checkActionClassAllowed } from "./lib/schema-lock.mjs";

const AGNTUX_ROOT = join(homedir(), "agntux");
const ENTITIES_ROOT = join(AGNTUX_ROOT, "entities");
const ACTIONS_ROOT = join(AGNTUX_ROOT, "actions");

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
  if (basename(filePath) === "_index.md") return null; // index files are hook-managed, not agent-written
  if (filePath.startsWith(ENTITIES_ROOT + sep)) return "entity";
  if (filePath.startsWith(ACTIONS_ROOT + sep)) return "action";
  return null;
}

function sourceTokenToSlug(token) {
  if (typeof token !== "string" || !SOURCE_TO_PLUGIN_RE.test(token)) return null;
  // Already a full slug — accept verbatim.
  if (token.endsWith("-ingest") || token === "agntux-core") return token;
  // Convention: a bare source name like `notes` maps to `notes-ingest`.
  return `${token}-ingest`;
}

function resolvePluginSlug(ctx, fm) {
  // Priority 1: hook event payload (canonical hook bundle convention).
  const fromHook = ctx?.plugin || ctx?.hook_event?.plugin || ctx?.event?.plugin;
  const fromHookSlug = sourceTokenToSlug(fromHook);
  if (fromHookSlug) return fromHookSlug;

  // Priority 2: action-item frontmatter `source` (e.g., `notes` → `notes-ingest`).
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
  if (pluginSlug && pluginSlug !== "agntux-core") {
    const contract = lock.plugin_contracts[pluginSlug];
    if (contract && contract.schema_version && fm.schema_version !== contract.schema_version) {
      reject(
        `${basename(filePath)} schema_version \`${fm.schema_version}\` does not match \`${pluginSlug}\` contract version \`${contract.schema_version}\` — re-run \`/ux schema review ${pluginSlug}\` to refresh`
      );
    }
  }

  pass();
}

main();

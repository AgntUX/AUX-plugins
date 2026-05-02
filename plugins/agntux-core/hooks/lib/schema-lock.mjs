// Helper for reading + verifying ~/agntux-code/data/schema/schema.lock.json.
// Used by validate-schema.mjs (PreToolUse) and the data-architect subagent.
//
// The lock is the deterministic digest of the markdown source files under
// ~/agntux-code/data/schema/. The architect regenerates it on every write; the
// validator reads it on every entity/action write.
//
// P3a §6.1 specifies the shape:
//   { schema_version, generated_at, entity_subtypes[], action_classes[],
//     plugin_contracts: { {slug}: { schema_version, allowed_subtypes[],
//       allowed_action_classes[], approved_at, source_id_format } },
//     checksum: "sha256:..." }
//
// The cache TTL is intentional: hot validations (multiple entity writes per
// turn) shouldn't pay for fresh disk reads each time, but the architect's
// lock-file rewrite must be picked up within a few seconds — set to 2s.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AGNTUX_ROOT = join(homedir(), "agntux");
const SCHEMA_DIR = join(AGNTUX_ROOT, "data", "schema");
const LOCK_PATH = join(SCHEMA_DIR, "schema.lock.json");

const CACHE_TTL_MS = 2_000;
let cached = null; // { lock, mtime, readAt }

/**
 * Read schema.lock.json with a short TTL cache.
 * Returns null when the lock is missing (validator falls back to "no schema yet" — open).
 * Throws when the lock exists but is malformed (validator must block until the architect fixes it).
 */
export function readSchemaLock() {
  if (!existsSync(LOCK_PATH)) {
    cached = null;
    return null;
  }

  const now = Date.now();
  if (cached && now - cached.readAt < CACHE_TTL_MS) {
    return cached.lock;
  }

  const raw = readFileSync(LOCK_PATH, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`schema.lock.json is not valid JSON: ${e.message}`);
  }

  validateLockShape(parsed);
  cached = { lock: parsed, readAt: now };
  return parsed;
}

function validateLockShape(lock) {
  if (typeof lock !== "object" || lock === null) {
    throw new Error("schema.lock.json must be a JSON object");
  }
  if (typeof lock.schema_version !== "string") {
    throw new Error("schema.lock.json missing string `schema_version`");
  }
  if (!Array.isArray(lock.entity_subtypes)) {
    throw new Error("schema.lock.json missing array `entity_subtypes`");
  }
  if (!Array.isArray(lock.action_classes)) {
    throw new Error("schema.lock.json missing array `action_classes`");
  }
  if (typeof lock.plugin_contracts !== "object" || lock.plugin_contracts === null) {
    throw new Error("schema.lock.json missing object `plugin_contracts`");
  }
}

/**
 * Plugins that bypass the per-plugin contract check.
 * The orchestrator (agntux-core) doesn't ingest data — it mutates existing
 * action items' status fields. Schema-level enum checks still run; only the
 * per-plugin allowed_subtypes / allowed_action_classes check is skipped.
 */
const ORCHESTRATOR_SLUGS = new Set(["agntux-core"]);

/**
 * Resolve the contract a given plugin slug is allowed to use.
 * Returns the contract record or null when the plugin has no approved contract yet.
 */
export function getPluginContract(lock, pluginSlug) {
  if (!lock || !pluginSlug) return null;
  const contract = lock.plugin_contracts[pluginSlug];
  if (!contract) return null;
  return contract;
}

/**
 * Check whether a plugin is allowed to write the given subtype.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export function checkSubtypeAllowed(lock, pluginSlug, subtype) {
  if (!lock) return { ok: true };
  if (!lock.entity_subtypes.includes(subtype)) {
    return {
      ok: false,
      reason: `subtype \`${subtype}\` is not in the tenant schema (allowed: ${lock.entity_subtypes.join(", ")})`,
    };
  }
  // No plugin attribution OR orchestrator-driven write — schema-level check only.
  if (!pluginSlug || ORCHESTRATOR_SLUGS.has(pluginSlug)) return { ok: true };

  const contract = getPluginContract(lock, pluginSlug);
  if (!contract) {
    return {
      ok: false,
      reason: `plugin \`${pluginSlug}\` has no approved contract — run \`/ux schema review ${pluginSlug}\` first`,
    };
  }
  if (!contract.allowed_subtypes.includes(subtype)) {
    return {
      ok: false,
      reason: `plugin \`${pluginSlug}\` is not authorised to write subtype \`${subtype}\` (allowed: ${contract.allowed_subtypes.join(", ")})`,
    };
  }
  return { ok: true };
}

/**
 * Check whether a plugin is allowed to write the given action_class.
 */
export function checkActionClassAllowed(lock, pluginSlug, actionClass) {
  if (!lock) return { ok: true };
  if (!lock.action_classes.includes(actionClass)) {
    return {
      ok: false,
      reason: `action_class \`${actionClass}\` is not in the tenant schema (allowed: ${lock.action_classes.join(", ")})`,
    };
  }
  if (!pluginSlug || ORCHESTRATOR_SLUGS.has(pluginSlug)) return { ok: true };

  const contract = getPluginContract(lock, pluginSlug);
  if (!contract) {
    return {
      ok: false,
      reason: `plugin \`${pluginSlug}\` has no approved contract — run \`/ux schema review ${pluginSlug}\` first`,
    };
  }
  if (
    Array.isArray(contract.allowed_action_classes) &&
    !contract.allowed_action_classes.includes(actionClass)
  ) {
    return {
      ok: false,
      reason: `plugin \`${pluginSlug}\` is not authorised to write action_class \`${actionClass}\` (allowed: ${contract.allowed_action_classes.join(", ")})`,
    };
  }
  return { ok: true };
}

/**
 * Test-only: clear the cache so unit tests can simulate consecutive writes.
 */
export function _resetSchemaLockCache() {
  cached = null;
}

export const SCHEMA_LOCK_PATH = LOCK_PATH;
export const SCHEMA_DIR_PATH = SCHEMA_DIR;

// Deterministic entity_id helper.
//
// P7 (data layout) ratifies a stable cross-namespace identifier for every
// entity carried across the personal data root, every team data root, and
// every leader-view that joins by entity. The value is computed from the
// pair (source, source_ref) the writing plugin already has in context; the
// validator hook computes the hash and bakes it into the rejection runbook.
// The LLM never invokes a hash function — it only Edit/Writes the value
// the hook supplies.
//
// Format (P7 §"Entity link"):
//   entity_id = sha256(source + ":" + source_ref).slice(0, 16)
//
// 16 hex chars = 64 bits, birthday-bound at ~2^32 entities (~4B). Realistic
// per-tenant counts sit below 10^6, so collisions are not a V1 concern.
//
// This file is the canonical source of truth. Byte-frozen copies live at:
//   - plugins/agntux-core/hooks/lib/entity-id.mjs
//   - plugins/agntux-teams/hooks/lib/entity-id.mjs (lands in S3.4)
// The byte-freeze invariant means edits to this canonical copy must be
// replicated character-for-character into each plugin's local lib/.

import { createHash } from "node:crypto";

/**
 * Compute the deterministic entity_id for a (source, source_ref) pair.
 *
 * Returns a 16-character lowercase hex string. Throws on missing or empty
 * inputs — the caller (the validator hook) treats that as "the LLM also
 * needs to supply source/source_ref before entity_id is computable" and
 * surfaces a different runbook for that case.
 *
 * @param {string} source     - the writing plugin's slug (e.g. "agntux-slack").
 * @param {string} sourceRef  - a stable natural key chosen by the source
 *                              (Slack `workspace:user_id`, Gmail `thread_id`,
 *                              kebab-cased identifier for onboarding entities).
 * @returns {string} 16-hex-char entity_id.
 */
export function computeEntityId(source, sourceRef) {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error("computeEntityId: source must be a non-empty string");
  }
  if (typeof sourceRef !== "string" || sourceRef.length === 0) {
    throw new Error("computeEntityId: sourceRef must be a non-empty string");
  }
  const digest = createHash("sha256").update(`${source}:${sourceRef}`).digest("hex");
  return digest.slice(0, 16);
}

/**
 * Validate the shape of an entity_id string without re-computing.
 * Returns true if the value is a 16-character lowercase hex string.
 */
export function isWellFormedEntityId(value) {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
}

// Hook-computed trigger_key for team action items.
//
// P9 contract:
//   trigger_key = sha256(team_slug + ":" + reason_class + ":" + entity_id_or_source_ref).slice(0, 16)
//
// 16 hex chars = 64 bits, birthday-bound at ~4B trigger keys — far beyond
// any realistic team's action volume.
//
// The LLM never computes this hash. The validator hook (validate-team-schema.mjs
// in agntux-teams, P9-amended) reads team_slug, reason_class, and the first
// entity_refs[0].entity_id (falling back to source_ref when no entity ref is
// present), computes expected_trigger_key, and rejects writes that don't
// match — emitting the runbook with the correct value.
//
// This file is the single source of truth and is byte-frozen into
// agntux-teams/hooks/lib/trigger-key.mjs per the master-plan hooks invariant.

import { createHash } from "node:crypto";

/**
 * Compute the deterministic trigger_key for a team action item.
 *
 * @param {string} teamSlug — the team's directory key (immutable per P7).
 * @param {string} reasonClass — one of the team's declared reason_class values
 *   from team-config.md. Pass the exact string the LLM picked; case matters.
 * @param {string} entityIdOrSourceRef — for items tied to an entity, the
 *   subject entity's `entity_id` (16-hex). For items with no single subject
 *   entity, the source-native `source_ref` (e.g., a Slack thread id).
 * @returns {string} 16-character lowercase hex string.
 */
export function computeTriggerKey(teamSlug, reasonClass, entityIdOrSourceRef) {
  if (typeof teamSlug !== "string" || teamSlug.length === 0) {
    throw new Error("computeTriggerKey: teamSlug must be a non-empty string");
  }
  if (typeof reasonClass !== "string" || reasonClass.length === 0) {
    throw new Error("computeTriggerKey: reasonClass must be a non-empty string");
  }
  if (
    typeof entityIdOrSourceRef !== "string" ||
    entityIdOrSourceRef.length === 0
  ) {
    throw new Error(
      "computeTriggerKey: entityIdOrSourceRef must be a non-empty string",
    );
  }
  const input = `${teamSlug}:${reasonClass}:${entityIdOrSourceRef}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Resolve the trigger-key inputs from a parsed action frontmatter object.
 *
 * Encapsulates the "entity_id of entity_refs[0], else source_ref" fallback
 * so callers (validator + maintain-team-index) agree byte-for-byte on
 * what feeds the hash.
 *
 * Returns { teamSlug, reasonClass, entityIdOrSourceRef } when all three
 * inputs are present, otherwise null (validator treats null as a frontmatter
 * shape error and emits a separate runbook).
 */
export function resolveTriggerInputs(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object") return null;
  const teamSlug =
    typeof frontmatter.team_slug === "string" ? frontmatter.team_slug : null;
  const reasonClass =
    typeof frontmatter.reason_class === "string"
      ? frontmatter.reason_class
      : null;

  let entityIdOrSourceRef = null;
  const refs = frontmatter.entity_refs;
  if (Array.isArray(refs) && refs.length > 0) {
    const first = refs[0];
    if (first && typeof first === "object" && typeof first.entity_id === "string") {
      entityIdOrSourceRef = first.entity_id;
    }
  }
  if (entityIdOrSourceRef === null && typeof frontmatter.source_ref === "string") {
    entityIdOrSourceRef = frontmatter.source_ref;
  }

  if (!teamSlug || !reasonClass || !entityIdOrSourceRef) return null;
  return { teamSlug, reasonClass, entityIdOrSourceRef };
}

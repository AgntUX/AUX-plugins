// Hook-computed triggered_by_rule_hash for leader-view action items.
//
// P7 contract:
//   triggered_by_rule_hash = sha256(rule_slug + ":" + trigger_inputs).slice(0, 16)
//
// 16 hex chars = 64 bits, birthday-bound at ~4B distinct rule fires — well
// beyond any realistic leader-view's volume.
//
// The LLM never computes this hash. The validator hook
// (validate-leader-view-rule-hash.mjs in agntux-teams) reads `triggered_by_rule`
// (the rule's stable slug as authored in view-config.md) and `trigger_inputs`
// (the LLM-composed canonical key string for the triggering data — typically
// the source team_slug + the entity_id or action id), computes
// expected_rule_hash, and rejects writes that don't match — emitting the
// runbook with the correct value.
//
// This file is the single source of truth and is byte-frozen into
// agntux-teams/hooks/lib/rule-hash.mjs per the master-plan hooks invariant.

import { createHash } from "node:crypto";

/**
 * Compute the deterministic triggered_by_rule_hash for a leader-view action.
 *
 * @param {string} ruleSlug — the rule's stable slug (kebab-cased heading from
 *   view-config.md's body). Renaming the rule changes the slug, which changes
 *   the hash — that's intentional, since the rule's semantics change too.
 * @param {string} triggerInputs — the LLM-composed canonical key string for
 *   the triggering data. The convention is `<source-team-slug>:<entity_id-or-action-id>`
 *   so two passes over the same data produce the same hash. The skill body is
 *   responsible for normalising this string; the hash takes it verbatim.
 * @returns {string} 16-character lowercase hex string.
 */
export function computeRuleHash(ruleSlug, triggerInputs) {
  if (typeof ruleSlug !== "string" || ruleSlug.length === 0) {
    throw new Error("computeRuleHash: ruleSlug must be a non-empty string");
  }
  if (typeof triggerInputs !== "string" || triggerInputs.length === 0) {
    throw new Error(
      "computeRuleHash: triggerInputs must be a non-empty string",
    );
  }
  const input = `${ruleSlug}:${triggerInputs}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Resolve the rule-hash inputs from a parsed action frontmatter object.
 *
 * Returns { ruleSlug, triggerInputs } when both inputs are present, otherwise
 * null. The validator treats null as a frontmatter shape error and emits a
 * separate (required-fields) rejection runbook.
 *
 * Frontmatter shape the LLM authors:
 *   triggered_by_rule: <rule-slug>           # stable slug for the rule
 *   trigger_inputs: <canonical-input-string> # LLM-composed natural-key string
 *   triggered_by_rule_hash: ""               # validator fills this in
 */
export function resolveRuleHashInputs(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object") return null;
  const ruleSlug =
    typeof frontmatter.triggered_by_rule === "string"
      ? frontmatter.triggered_by_rule.trim()
      : null;
  const triggerInputs =
    typeof frontmatter.trigger_inputs === "string"
      ? frontmatter.trigger_inputs.trim()
      : null;
  if (!ruleSlug || !triggerInputs) return null;
  return { ruleSlug, triggerInputs };
}

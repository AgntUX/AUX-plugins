// rule-hash.mjs unit tests.
// Per P7:
//   triggered_by_rule_hash = sha256(rule_slug + ":" + trigger_inputs).slice(0, 16)
//
// Hash is hook-computed; the LLM never computes it. These tests pin the
// determinism + the resolve-from-frontmatter fallback so any drift between
// the canonical helper and the byte-frozen copy in hooks/lib/ is caught.

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  computeRuleHash,
  resolveRuleHashInputs,
} from "../hooks/lib/rule-hash.mjs";

function expectedHash(ruleSlug, triggerInputs) {
  return createHash("sha256")
    .update(`${ruleSlug}:${triggerInputs}`)
    .digest("hex")
    .slice(0, 16);
}

describe("computeRuleHash", () => {
  it("returns a 16-character lowercase hex string", () => {
    const h = computeRuleHash("unhappy-high-revenue", "customer-success:8f4b2c1d3e5a7b9c");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — identical inputs produce identical outputs", () => {
    const a = computeRuleHash("rule-a", "team:e1");
    const b = computeRuleHash("rule-a", "team:e1");
    expect(a).toBe(b);
  });

  it("matches the explicit sha256-then-truncate formula", () => {
    const h = computeRuleHash("sprint-kudos", "infrastructure:2026-W19");
    expect(h).toBe(expectedHash("sprint-kudos", "infrastructure:2026-W19"));
  });

  it("differs when rule_slug differs", () => {
    const a = computeRuleHash("rule-a", "team:e1");
    const b = computeRuleHash("rule-b", "team:e1");
    expect(a).not.toBe(b);
  });

  it("differs when trigger_inputs differ", () => {
    const a = computeRuleHash("rule-a", "team:e1");
    const b = computeRuleHash("rule-a", "team:e2");
    expect(a).not.toBe(b);
  });

  it("rejects empty inputs", () => {
    expect(() => computeRuleHash("", "y")).toThrow();
    expect(() => computeRuleHash("x", "")).toThrow();
  });

  it("rejects non-string inputs", () => {
    expect(() => computeRuleHash(null, "y")).toThrow();
    expect(() => computeRuleHash("x", undefined)).toThrow();
    expect(() => computeRuleHash("x", 42)).toThrow();
  });
});

describe("resolveRuleHashInputs", () => {
  it("pulls triggered_by_rule and trigger_inputs from frontmatter", () => {
    const fm = {
      triggered_by_rule: "unhappy-high-revenue",
      trigger_inputs: "customer-success:8f4b2c1d3e5a7b9c",
    };
    expect(resolveRuleHashInputs(fm)).toEqual({
      ruleSlug: "unhappy-high-revenue",
      triggerInputs: "customer-success:8f4b2c1d3e5a7b9c",
    });
  });

  it("trims surrounding whitespace from both fields", () => {
    const fm = {
      triggered_by_rule: "  rule-a  ",
      trigger_inputs: "\tteam:e1\n",
    };
    expect(resolveRuleHashInputs(fm)).toEqual({
      ruleSlug: "rule-a",
      triggerInputs: "team:e1",
    });
  });

  it("returns null when triggered_by_rule is missing", () => {
    expect(resolveRuleHashInputs({ trigger_inputs: "team:e1" })).toBeNull();
  });

  it("returns null when trigger_inputs is missing", () => {
    expect(resolveRuleHashInputs({ triggered_by_rule: "rule-a" })).toBeNull();
  });

  it("returns null when either field is empty after trim", () => {
    expect(
      resolveRuleHashInputs({ triggered_by_rule: "  ", trigger_inputs: "x" }),
    ).toBeNull();
    expect(
      resolveRuleHashInputs({ triggered_by_rule: "x", trigger_inputs: "  " }),
    ).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(resolveRuleHashInputs(null)).toBeNull();
    expect(resolveRuleHashInputs(undefined)).toBeNull();
    expect(resolveRuleHashInputs("string")).toBeNull();
  });

  it("integrates end-to-end with computeRuleHash", () => {
    const fm = {
      triggered_by_rule: "unhappy-high-revenue",
      trigger_inputs: "customer-success:8f4b2c1d3e5a7b9c",
    };
    const inputs = resolveRuleHashInputs(fm);
    const h = computeRuleHash(inputs.ruleSlug, inputs.triggerInputs);
    expect(h).toBe(
      expectedHash("unhappy-high-revenue", "customer-success:8f4b2c1d3e5a7b9c"),
    );
  });
});

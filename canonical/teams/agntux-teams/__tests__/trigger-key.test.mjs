// trigger-key.mjs unit tests.
// Per P9:
//   trigger_key = sha256(team_slug + ":" + reason_class + ":" + entity_id_or_source_ref).slice(0, 16)
//
// The hash is hook-computed; the LLM never computes it. These tests pin the
// determinism + the resolve-from-frontmatter fallback so any drift between
// the canonical helper and the byte-frozen copy in hooks/lib/ is caught.

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  computeTriggerKey,
  resolveTriggerInputs,
} from "../hooks/lib/trigger-key.mjs";

function expectedKey(teamSlug, reasonClass, entityIdOrSourceRef) {
  return createHash("sha256")
    .update(`${teamSlug}:${reasonClass}:${entityIdOrSourceRef}`)
    .digest("hex")
    .slice(0, 16);
}

describe("computeTriggerKey", () => {
  it("returns a 16-character lowercase hex string", () => {
    const key = computeTriggerKey("platform", "customer-pain", "8f4b2c1d3e5a7b9c");
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — identical inputs produce identical outputs", () => {
    const a = computeTriggerKey("platform", "customer-pain", "8f4b2c1d3e5a7b9c");
    const b = computeTriggerKey("platform", "customer-pain", "8f4b2c1d3e5a7b9c");
    expect(a).toBe(b);
  });

  it("matches the explicit sha256-then-truncate formula", () => {
    const key = computeTriggerKey("sales", "renewal-risk", "acme-thread-42");
    expect(key).toBe(expectedKey("sales", "renewal-risk", "acme-thread-42"));
  });

  it("differs when team_slug differs", () => {
    const a = computeTriggerKey("platform", "customer-pain", "e1");
    const b = computeTriggerKey("infra", "customer-pain", "e1");
    expect(a).not.toBe(b);
  });

  it("differs when reason_class differs", () => {
    const a = computeTriggerKey("platform", "customer-pain", "e1");
    const b = computeTriggerKey("platform", "product-decisions", "e1");
    expect(a).not.toBe(b);
  });

  it("differs when entity_id_or_source_ref differs", () => {
    const a = computeTriggerKey("platform", "customer-pain", "e1");
    const b = computeTriggerKey("platform", "customer-pain", "e2");
    expect(a).not.toBe(b);
  });

  it("rejects empty inputs", () => {
    expect(() => computeTriggerKey("", "x", "y")).toThrow();
    expect(() => computeTriggerKey("x", "", "y")).toThrow();
    expect(() => computeTriggerKey("x", "y", "")).toThrow();
  });

  it("rejects non-string inputs", () => {
    expect(() => computeTriggerKey(null, "x", "y")).toThrow();
    expect(() => computeTriggerKey("x", undefined, "y")).toThrow();
    expect(() => computeTriggerKey("x", "y", 42)).toThrow();
  });
});

describe("resolveTriggerInputs", () => {
  it("pulls team_slug, reason_class, and entity_refs[0].entity_id from frontmatter", () => {
    const fm = {
      team_slug: "platform",
      reason_class: "customer-pain",
      entity_refs: [{ entity_id: "8f4b2c1d3e5a7b9c", role: "subject" }],
    };
    expect(resolveTriggerInputs(fm)).toEqual({
      teamSlug: "platform",
      reasonClass: "customer-pain",
      entityIdOrSourceRef: "8f4b2c1d3e5a7b9c",
    });
  });

  it("falls back to source_ref when entity_refs is absent", () => {
    const fm = {
      team_slug: "sales",
      reason_class: "renewal-risk",
      source_ref: "acme-thread-42",
    };
    expect(resolveTriggerInputs(fm)).toEqual({
      teamSlug: "sales",
      reasonClass: "renewal-risk",
      entityIdOrSourceRef: "acme-thread-42",
    });
  });

  it("falls back to source_ref when entity_refs is empty", () => {
    const fm = {
      team_slug: "sales",
      reason_class: "renewal-risk",
      entity_refs: [],
      source_ref: "fallback-ref",
    };
    expect(resolveTriggerInputs(fm)).toEqual({
      teamSlug: "sales",
      reasonClass: "renewal-risk",
      entityIdOrSourceRef: "fallback-ref",
    });
  });

  it("prefers entity_id over source_ref when both present", () => {
    const fm = {
      team_slug: "platform",
      reason_class: "x",
      entity_refs: [{ entity_id: "preferred" }],
      source_ref: "ignored",
    };
    expect(resolveTriggerInputs(fm)?.entityIdOrSourceRef).toBe("preferred");
  });

  it("returns null when team_slug is missing", () => {
    const fm = { reason_class: "x", source_ref: "y" };
    expect(resolveTriggerInputs(fm)).toBeNull();
  });

  it("returns null when reason_class is missing", () => {
    const fm = { team_slug: "x", source_ref: "y" };
    expect(resolveTriggerInputs(fm)).toBeNull();
  });

  it("returns null when neither entity_refs[0].entity_id nor source_ref is present", () => {
    const fm = { team_slug: "x", reason_class: "y" };
    expect(resolveTriggerInputs(fm)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(resolveTriggerInputs(null)).toBeNull();
    expect(resolveTriggerInputs(undefined)).toBeNull();
    expect(resolveTriggerInputs("string")).toBeNull();
  });

  it("integrates end-to-end with computeTriggerKey", () => {
    const fm = {
      team_slug: "platform",
      reason_class: "customer-pain",
      entity_refs: [{ entity_id: "8f4b2c1d3e5a7b9c" }],
    };
    const inputs = resolveTriggerInputs(fm);
    const key = computeTriggerKey(
      inputs.teamSlug,
      inputs.reasonClass,
      inputs.entityIdOrSourceRef,
    );
    expect(key).toBe(expectedKey("platform", "customer-pain", "8f4b2c1d3e5a7b9c"));
  });
});

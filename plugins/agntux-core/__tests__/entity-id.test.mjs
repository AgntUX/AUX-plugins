// Unit tests for canonical/hooks/lib/entity-id.mjs (byte-frozen copy at
// plugins/agntux-core/hooks/lib/entity-id.mjs).
//
// The helper computes entity_id = sha256(source + ":" + source_ref).slice(0, 16)
// and is the single source of truth for the deterministic identifier P7 uses
// to join personal + team entity copies.

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { computeEntityId, isWellFormedEntityId } from "../hooks/lib/entity-id.mjs";

function manualReference(source, sourceRef) {
  return createHash("sha256").update(`${source}:${sourceRef}`).digest("hex").slice(0, 16);
}

describe("computeEntityId", () => {
  it("returns a 16-character lowercase hex string", () => {
    const out = computeEntityId("agntux-slack", "T01XYZ:U02ABC");
    expect(out).toMatch(/^[0-9a-f]{16}$/);
    expect(out).toHaveLength(16);
  });

  it("is deterministic for the same inputs", () => {
    const a = computeEntityId("agntux-gmail", "thread-123");
    const b = computeEntityId("agntux-gmail", "thread-123");
    expect(a).toBe(b);
  });

  it("matches the reference sha256(source + ':' + source_ref).slice(0, 16)", () => {
    // Pin against an independent implementation; if either drifts, the test
    // catches it before the byte-frozen copies under plugins/*/hooks/lib/
    // diverge from canonical.
    const cases = [
      ["agntux-slack", "T01XYZ:U02ABC123"],
      ["agntux-gmail", "thread-id-with-dashes"],
      ["agntux-core", "john-jordan"],
      ["agntux-notes", "/Users/me/note.md"],
    ];
    for (const [source, ref] of cases) {
      expect(computeEntityId(source, ref)).toBe(manualReference(source, ref));
    }
  });

  it("flips entirely when either input changes (no surface collision among realistic keys)", () => {
    const base = computeEntityId("agntux-slack", "T01:U02");
    expect(computeEntityId("agntux-slack", "T01:U03")).not.toBe(base);
    expect(computeEntityId("agntux-gmail", "T01:U02")).not.toBe(base);
  });

  it("treats `source:source_ref` as a SINGLE concatenated input — the colon is part of the format", () => {
    // Adversarial: ("agntux", "slack:T01") MUST NOT collide with
    // ("agntux-slack", "T01") just because both stringify to the same
    // intermediate when joined with ":". The current formula concatenates
    // source + ":" + source_ref, so these two pairs produce DIFFERENT
    // strings ("agntux:slack:T01" vs "agntux-slack:T01") and thus different
    // hashes — but a future refactor that strips empty middles or
    // re-joins differently could regress here.
    const a = computeEntityId("agntux", "slack:T01");
    const b = computeEntityId("agntux-slack", "T01");
    expect(a).not.toBe(b);
  });

  it("throws on missing/empty source", () => {
    expect(() => computeEntityId("", "ref")).toThrow(/source/);
    expect(() => computeEntityId(undefined, "ref")).toThrow();
    expect(() => computeEntityId(null, "ref")).toThrow();
  });

  it("throws on missing/empty source_ref", () => {
    expect(() => computeEntityId("agntux-slack", "")).toThrow(/sourceRef/);
    expect(() => computeEntityId("agntux-slack", undefined)).toThrow();
  });
});

describe("isWellFormedEntityId", () => {
  it("accepts 16-char lowercase hex", () => {
    expect(isWellFormedEntityId(computeEntityId("a", "b"))).toBe(true);
    expect(isWellFormedEntityId("0123456789abcdef")).toBe(true);
  });

  it("rejects wrong length, wrong case, non-hex characters, and non-strings", () => {
    expect(isWellFormedEntityId("0123456789abcde")).toBe(false); // 15
    expect(isWellFormedEntityId("0123456789abcdef0")).toBe(false); // 17
    expect(isWellFormedEntityId("0123456789ABCDEF")).toBe(false); // uppercase
    expect(isWellFormedEntityId("0123456789abcdeg")).toBe(false); // non-hex
    expect(isWellFormedEntityId(null)).toBe(false);
    expect(isWellFormedEntityId(undefined)).toBe(false);
    expect(isWellFormedEntityId(123)).toBe(false);
  });
});

describe("entity-id canonical/plugin-local byte-freeze", () => {
  it("plugins/agntux-core/hooks/lib/entity-id.mjs is byte-identical to canonical/hooks/lib/entity-id.mjs", async () => {
    // The byte-frozen-copy invariant means any drift here is a bug — the
    // canonical file is the source of truth and the plugin's copy must be
    // updated character-for-character. Pre-fail if they diverge so the
    // commit doesn't ship an inconsistent pair.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { join, dirname } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const pluginCopy = readFileSync(
      join(here, "..", "hooks", "lib", "entity-id.mjs"),
      "utf8",
    );
    // Walk up from plugins/agntux-core/__tests__/ → repo root → canonical/.
    const canonical = readFileSync(
      join(here, "..", "..", "..", "canonical", "hooks", "lib", "entity-id.mjs"),
      "utf8",
    );
    expect(pluginCopy).toBe(canonical);
  });
});

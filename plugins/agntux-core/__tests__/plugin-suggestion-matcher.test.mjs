/**
 * plugin-suggestion-matcher.test.mjs
 *
 * Unit tests for the plugin-suggestions.json registry.
 *
 * 4.0.0 change: role-based rules are gone. The registry is a single
 * default-suggestion list. The architect filters this list against the
 * user's discovery context (`<agntux project root>/user.md → # Discovery /
 * discovery_summary / # Sources`) and may also recommend connectors
 * directly from discovery answers — the registry is just a starting point.
 *
 * The tests below verify the new shape, not role-matching logic.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUGGESTIONS_PATH = join(PLUGIN_ROOT, "data", "plugin-suggestions.json");

describe("plugin-suggestions.json file exists and is valid JSON", () => {
  it("data/plugin-suggestions.json exists", () => {
    expect(existsSync(SUGGESTIONS_PATH)).toBe(true);
  });

  it("parses as valid JSON", () => {
    const raw = readFileSync(SUGGESTIONS_PATH, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("has a version field", () => {
    const registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
    expect(typeof registry.version).toBe("number");
    // 4.0.0 bumped registry shape from v2 (rules array) to v3 (default array).
    expect(registry.version).toBeGreaterThanOrEqual(3);
  });

  it("has a default array (no rules array — 4.0.0 simplification)", () => {
    const registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
    expect(Array.isArray(registry.default)).toBe(true);
    expect(registry.default.length).toBeGreaterThan(0);
    // Role-based rules removed in 4.0.0 — architect uses
    // schema-design-rubric.md plus discovery context instead.
    expect(registry.rules).toBeUndefined();
  });
});

describe("registry schema invariants", () => {
  let registry;

  beforeAll(() => {
    registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
  });

  it("every default entry has slug and status fields", () => {
    for (const entry of registry.default) {
      expect(typeof entry.slug).toBe("string");
      expect(["available", "coming-soon"]).toContain(entry.status);
    }
  });

  it("all slugs are lowercase-hyphenated strings", () => {
    const slugPattern = /^[a-z0-9-]+$/;
    for (const entry of registry.default) {
      expect(entry.slug).toMatch(slugPattern);
    }
  });

  it("at least one entry has status: 'available' so Mode A can offer something to every user", () => {
    const available = registry.default.filter((e) => e.status === "available");
    expect(available.length).toBeGreaterThan(0);
  });

  it("notes-ingest is on the default list (the universal first plugin)", () => {
    const slugs = registry.default.map((e) => e.slug);
    expect(slugs).toContain("notes-ingest");
  });
});

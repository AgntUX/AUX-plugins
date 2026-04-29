/**
 * plugin-suggestion-matcher.test.mjs
 *
 * Unit tests for the plugin-suggestions.json registry (T42 §6).
 * Strategy: load the JSON file and verify that role matching logic
 * — as the personalization subagent would execute it — returns the
 * correct plugin suggestion list for each persona type.
 *
 * The matcher algorithm mirrors what agents/personalization.md specifies:
 * case-insensitive substring match against `if_role_matches` arrays,
 * first matching rule wins, fallback to the `default` rule.
 *
 * MAJOR #4 fix: import order corrected — all vitest imports at top.
 * MAJOR #3 fix: default lookup hoisted to a separate pass after the
 *   role-match loop so rule reordering cannot silently break fallback.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUGGESTIONS_PATH = join(PLUGIN_ROOT, "data", "plugin-suggestions.json");

// ---------------------------------------------------------------------------
// Inline matcher — mirrors the logic personalization.md instructs the agent
// to apply when reading plugin-suggestions.json.
//
// MAJOR #3 fix: default rule lookup is a separate pass AFTER the role-match
// loop. Previously, if `default` appeared first in rules[], it would fire for
// every call (because the loop returned rule.default before checking
// if_role_matches). Now: iterate once for role matches, then fall back to
// default only if nothing matched.
// ---------------------------------------------------------------------------

/**
 * @param {string} role - The user's role string from user.md # Identity.
 * @param {object} registry - Parsed plugin-suggestions.json content.
 * @returns {{ slug: string, status: string }[]} Ordered list of suggestion objects.
 */
function matchSuggestions(role, registry) {
  const roleLower = role.trim().toLowerCase();

  // Pass 1: role-specific rules only (skip default in this pass).
  for (const rule of registry.rules) {
    if (rule.if_role_matches) {
      const matched = rule.if_role_matches.some((keyword) => {
        const kw = keyword.toLowerCase();
        // Single-word keywords use whole-token match to prevent false positives
        // (e.g. "pm" inside "compm director"). Multi-word keywords use substring
        // match because they are already specific enough.
        if (!kw.includes(" ")) {
          return new RegExp(`(?<![a-z0-9])${kw}(?![a-z0-9])`, "i").test(
            roleLower
          );
        }
        return roleLower.includes(kw);
      });
      if (matched) {
        return rule.suggest;
      }
    }
  }

  // Pass 2: fallback — find the default rule regardless of position.
  for (const rule of registry.rules) {
    if (rule.default) {
      return rule.default;
    }
  }

  return [];
}

/**
 * Returns the slugs that are "available" (installable) from a suggestion list.
 * @param {{ slug: string, status: string }[]} suggestions
 * @returns {string[]}
 */
function availableSlugs(suggestions) {
  return suggestions
    .filter((s) => s.status === "available")
    .map((s) => s.slug);
}

/**
 * Returns all slugs (available + coming-soon) from a suggestion list.
 * @param {{ slug: string, status: string }[]} suggestions
 * @returns {string[]}
 */
function allSlugs(suggestions) {
  return suggestions.map((s) => s.slug);
}

// ---------------------------------------------------------------------------
// Load fixture
// ---------------------------------------------------------------------------

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
  });

  it("has a rules array", () => {
    const registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
    expect(Array.isArray(registry.rules)).toBe(true);
    expect(registry.rules.length).toBeGreaterThan(0);
  });

  it("exactly one rule has a default key (fallback rule)", () => {
    const registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
    const defaultRules = registry.rules.filter((r) => r.default !== undefined);
    expect(defaultRules.length).toBe(1);
    expect(Array.isArray(defaultRules[0].default)).toBe(true);
  });

  it("default rule appears last (conventional ordering)", () => {
    const registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
    const lastRule = registry.rules[registry.rules.length - 1];
    expect(lastRule).toHaveProperty("default");
    expect(Array.isArray(lastRule.default)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Role matching — PM / Product Manager persona
// ---------------------------------------------------------------------------

describe("PM / Product Manager persona", () => {
  let registry;

  beforeAll(() => {
    registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
  });

  it("matches exact 'pm' role", () => {
    const suggestions = matchSuggestions("PM", registry);
    expect(allSlugs(suggestions)).toContain("slack-ingest");
    expect(allSlugs(suggestions)).toContain("jira-ingest");
    expect(allSlugs(suggestions)).toContain("gmail-ingest");
  });

  it("matches 'Product Manager'", () => {
    const suggestions = matchSuggestions("Product Manager", registry);
    expect(allSlugs(suggestions)).toContain("slack-ingest");
    expect(allSlugs(suggestions)).toContain("jira-ingest");
    expect(allSlugs(suggestions)).toContain("gmail-ingest");
  });

  it("matches 'Director of Product'", () => {
    const suggestions = matchSuggestions("Director of Product", registry);
    expect(allSlugs(suggestions)).toContain("slack-ingest");
    expect(allSlugs(suggestions)).toContain("jira-ingest");
  });

  it("matches 'VP of Product at Acme'", () => {
    const suggestions = matchSuggestions("VP of Product at Acme", registry);
    expect(allSlugs(suggestions)).toContain("slack-ingest");
  });

  it("does NOT include github-ingest for PM", () => {
    const suggestions = matchSuggestions("Product Manager", registry);
    expect(allSlugs(suggestions)).not.toContain("github-ingest");
  });

  it("slack-ingest is coming-soon for PM persona (not yet installable)", () => {
    const suggestions = matchSuggestions("Product Manager", registry);
    const slackEntry = suggestions.find((s) => s.slug === "slack-ingest");
    expect(slackEntry).toBeDefined();
    expect(slackEntry.status).toBe("coming-soon");
  });
});

// ---------------------------------------------------------------------------
// Role matching — SWE / Software Engineer persona
// ---------------------------------------------------------------------------

describe("SWE / Software Engineer persona", () => {
  let registry;

  beforeAll(() => {
    registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
  });

  it("matches exact 'swe'", () => {
    const suggestions = matchSuggestions("SWE", registry);
    expect(allSlugs(suggestions)).toContain("jira-ingest");
    expect(allSlugs(suggestions)).toContain("github-ingest");
    expect(allSlugs(suggestions)).toContain("slack-ingest");
  });

  it("matches 'Software Engineer'", () => {
    const suggestions = matchSuggestions("Software Engineer", registry);
    expect(allSlugs(suggestions)).toContain("jira-ingest");
    expect(allSlugs(suggestions)).toContain("github-ingest");
    expect(allSlugs(suggestions)).toContain("slack-ingest");
  });

  it("matches 'Engineering Manager at Globex'", () => {
    const suggestions = matchSuggestions("Engineering Manager at Globex", registry);
    expect(allSlugs(suggestions)).toContain("jira-ingest");
    expect(allSlugs(suggestions)).toContain("github-ingest");
  });

  it("matches 'Staff Engineer'", () => {
    const suggestions = matchSuggestions("Staff Engineer", registry);
    expect(allSlugs(suggestions)).toContain("github-ingest");
  });

  it("matches 'Frontend Engineer'", () => {
    const suggestions = matchSuggestions("Frontend Engineer", registry);
    expect(allSlugs(suggestions)).toContain("github-ingest");
  });

  it("does NOT include gmail-ingest for SWE", () => {
    const suggestions = matchSuggestions("Software Engineer", registry);
    expect(allSlugs(suggestions)).not.toContain("gmail-ingest");
  });

  it("slack-ingest is coming-soon for SWE persona (not yet installable)", () => {
    const suggestions = matchSuggestions("Software Engineer", registry);
    const slackEntry = suggestions.find((s) => s.slug === "slack-ingest");
    expect(slackEntry).toBeDefined();
    expect(slackEntry.status).toBe("coming-soon");
  });
});

// ---------------------------------------------------------------------------
// Default fallback — unrecognised role
// ---------------------------------------------------------------------------

describe("default fallback for unrecognised roles", () => {
  let registry;

  beforeAll(() => {
    registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
  });

  it("returns default suggestions for 'Nurse Practitioner'", () => {
    const suggestions = matchSuggestions("Nurse Practitioner", registry);
    expect(allSlugs(suggestions)).toContain("notes-ingest");
    expect(allSlugs(suggestions)).toContain("gmail-ingest");
  });

  it("returns default suggestions for 'Chef'", () => {
    const suggestions = matchSuggestions("Chef", registry);
    expect(allSlugs(suggestions)).toContain("notes-ingest");
  });

  it("returns default suggestions for empty role string", () => {
    const suggestions = matchSuggestions("", registry);
    expect(allSlugs(suggestions)).toContain("notes-ingest");
  });

  it("does NOT include github-ingest for default", () => {
    const suggestions = matchSuggestions("Teacher", registry);
    expect(allSlugs(suggestions)).not.toContain("github-ingest");
  });

  it("does NOT include jira-ingest for default", () => {
    const suggestions = matchSuggestions("Accountant", registry);
    expect(allSlugs(suggestions)).not.toContain("jira-ingest");
  });

  it("notes-ingest is available for default persona", () => {
    const suggestions = matchSuggestions("Chef", registry);
    const notesEntry = suggestions.find((s) => s.slug === "notes-ingest");
    expect(notesEntry).toBeDefined();
    expect(notesEntry.status).toBe("available");
  });
});

// ---------------------------------------------------------------------------
// First-match-wins semantics
// ---------------------------------------------------------------------------

describe("first-match-wins rule ordering", () => {
  let registry;

  beforeAll(() => {
    registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
  });

  it("PM rule fires before SWE rule for 'PM' role", () => {
    const suggestions = matchSuggestions("PM", registry);
    // PM rule: [slack-ingest, jira-ingest, gmail-ingest]
    // SWE rule: [jira-ingest, github-ingest, slack-ingest]
    // If PM fires first, no github-ingest expected
    expect(allSlugs(suggestions)).not.toContain("github-ingest");
    expect(allSlugs(suggestions)).toContain("gmail-ingest");
  });

  it("'Engineering Manager' matches SWE rule (contains 'engineer')", () => {
    const suggestions = matchSuggestions("Engineering Manager", registry);
    expect(allSlugs(suggestions)).toContain("github-ingest");
  });
});

// ---------------------------------------------------------------------------
// MINOR #2: Word-boundary regression tests
//
// Single-word keywords like "pm" and "swe" must not match when they appear
// as a substring inside another word (e.g. "compm director", "swear").
// ---------------------------------------------------------------------------

describe("word-boundary matching for single-word keywords", () => {
  let registry;

  beforeAll(() => {
    registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
  });

  it("'compm director' does NOT match the PM rule", () => {
    // "pm" is embedded inside "compm" — must NOT fire the PM rule.
    // Verify by checking it falls to the DEFAULT rule (contains notes-ingest)
    // rather than the PM rule (contains jira-ingest).
    const suggestions = matchSuggestions("compm director", registry);
    expect(allSlugs(suggestions)).not.toContain("jira-ingest"); // PM rule has jira-ingest
    expect(allSlugs(suggestions)).toContain("notes-ingest"); // falls to default
  });

  it("'swear by agile' does NOT match the SWE rule", () => {
    // "swe" is embedded inside "swear" — must NOT fire the SWE rule
    const suggestions = matchSuggestions("swear by agile", registry);
    expect(allSlugs(suggestions)).not.toContain("github-ingest");
    expect(allSlugs(suggestions)).toContain("notes-ingest"); // falls to default
  });

  it("standalone 'pm' does match the PM rule", () => {
    const suggestions = matchSuggestions("pm", registry);
    expect(allSlugs(suggestions)).toContain("gmail-ingest");
    expect(allSlugs(suggestions)).not.toContain("notes-ingest");
  });

  it("standalone 'swe' does match the SWE rule", () => {
    const suggestions = matchSuggestions("swe", registry);
    expect(allSlugs(suggestions)).toContain("github-ingest");
    expect(allSlugs(suggestions)).not.toContain("notes-ingest");
  });

  it("'Senior PM at Acme' matches PM rule (word-boundary present)", () => {
    const suggestions = matchSuggestions("Senior PM at Acme", registry);
    expect(allSlugs(suggestions)).toContain("gmail-ingest");
    expect(allSlugs(suggestions)).not.toContain("notes-ingest");
  });
});

// ---------------------------------------------------------------------------
// MAJOR #3: Shuffle-resistant regression tests
//
// These tests verify that the matcher is correct regardless of rule order.
// They construct a reordered registry (default rule first) and confirm
// that: (a) PM/SWE roles still resolve to their correct rule, and (b)
// unrecognised roles still fall through to the default.
// ---------------------------------------------------------------------------

describe("shuffle-resistant: default-first registry produces same results", () => {
  let registryDefaultFirst;

  beforeAll(() => {
    const original = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
    // Move default rule to front — this would break the old matcher.
    const defaultRule = original.rules.find((r) => r.default !== undefined);
    const roleRules = original.rules.filter((r) => r.default === undefined);
    registryDefaultFirst = {
      ...original,
      rules: [defaultRule, ...roleRules],
    };
  });

  it("PM still gets PM suggestions when default rule is first", () => {
    const suggestions = matchSuggestions("Product Manager", registryDefaultFirst);
    expect(allSlugs(suggestions)).toContain("slack-ingest");
    expect(allSlugs(suggestions)).toContain("gmail-ingest");
    // Must NOT have gotten the default (notes-ingest only) result
    expect(allSlugs(suggestions)).not.toContain("notes-ingest");
  });

  it("SWE still gets SWE suggestions when default rule is first", () => {
    const suggestions = matchSuggestions("Software Engineer", registryDefaultFirst);
    expect(allSlugs(suggestions)).toContain("github-ingest");
    expect(allSlugs(suggestions)).not.toContain("notes-ingest");
  });

  it("unrecognised role still falls back to default when default rule is first", () => {
    const suggestions = matchSuggestions("Nurse Practitioner", registryDefaultFirst);
    expect(allSlugs(suggestions)).toContain("notes-ingest");
    expect(allSlugs(suggestions)).not.toContain("github-ingest");
  });

  it("empty role still returns default when default rule is first", () => {
    const suggestions = matchSuggestions("", registryDefaultFirst);
    expect(allSlugs(suggestions)).toContain("notes-ingest");
  });
});

// ---------------------------------------------------------------------------
// MAJOR #4: Unicode / whitespace edge-case tests
// ---------------------------------------------------------------------------

describe("unicode and whitespace edge cases", () => {
  let registry;

  beforeAll(() => {
    registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
  });

  it("leading/trailing whitespace: '  Product Manager  ' matches PM rule", () => {
    // trim() is applied inside matchSuggestions
    const suggestions = matchSuggestions("  Product Manager  ", registry);
    expect(allSlugs(suggestions)).toContain("slack-ingest");
    expect(allSlugs(suggestions)).not.toContain("notes-ingest");
  });

  it("all-caps: 'PRODUCT MANAGER' matches PM rule", () => {
    const suggestions = matchSuggestions("PRODUCT MANAGER", registry);
    expect(allSlugs(suggestions)).toContain("slack-ingest");
    expect(allSlugs(suggestions)).not.toContain("notes-ingest");
  });

  it("mixed case with whitespace: '  PRODUCT MANAGER  ' matches PM rule", () => {
    const suggestions = matchSuggestions("  PRODUCT MANAGER  ", registry);
    expect(allSlugs(suggestions)).toContain("slack-ingest");
    expect(allSlugs(suggestions)).not.toContain("github-ingest");
  });

  it("accented character role falls back to default (no role rule matches)", () => {
    // 'Médecin' (French for doctor) should not match any PM/SWE rule
    const suggestions = matchSuggestions("Médecin généraliste", registry);
    expect(allSlugs(suggestions)).toContain("notes-ingest");
    expect(allSlugs(suggestions)).not.toContain("github-ingest");
    expect(allSlugs(suggestions)).not.toContain("jira-ingest");
  });

  it("unicode emoji in role string falls back to default", () => {
    const suggestions = matchSuggestions("Chef 🍳", registry);
    expect(allSlugs(suggestions)).toContain("notes-ingest");
  });
});

// ---------------------------------------------------------------------------
// Registry schema invariants
// ---------------------------------------------------------------------------

describe("registry schema invariants", () => {
  let registry;

  beforeAll(() => {
    registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
  });

  it("every non-default rule has if_role_matches as non-empty array", () => {
    for (const rule of registry.rules) {
      if (!rule.default) {
        expect(Array.isArray(rule.if_role_matches)).toBe(true);
        expect(rule.if_role_matches.length).toBeGreaterThan(0);
      }
    }
  });

  it("every non-default rule has suggest as non-empty array", () => {
    for (const rule of registry.rules) {
      if (!rule.default) {
        expect(Array.isArray(rule.suggest)).toBe(true);
        expect(rule.suggest.length).toBeGreaterThan(0);
      }
    }
  });

  it("all suggested entries have slug and status fields", () => {
    for (const rule of registry.rules) {
      const entries = rule.default ?? rule.suggest ?? [];
      for (const entry of entries) {
        expect(typeof entry.slug).toBe("string");
        expect(["available", "coming-soon"]).toContain(entry.status);
      }
    }
  });

  it("all slugs are lowercase-hyphenated strings", () => {
    const slugPattern = /^[a-z0-9-]+$/;
    for (const rule of registry.rules) {
      const entries = rule.default ?? rule.suggest ?? [];
      for (const entry of entries) {
        expect(entry.slug).toMatch(slugPattern);
      }
    }
  });

  it("default rule has at least one 'available' entry (notes-ingest)", () => {
    // Role-specific rules (PM, SWE) may be all coming-soon pre-launch.
    // The default rule must always have at least one installable plugin
    // so Mode A can offer something to every user.
    const defaultRule = registry.rules.find((r) => r.default !== undefined);
    expect(defaultRule).toBeDefined();
    const available = defaultRule.default.filter(
      (e) => e.status === "available"
    );
    expect(available.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Available-only filtering (Mode A install-gate behavior)
// ---------------------------------------------------------------------------

describe("availableSlugs filter — Mode A install-gate", () => {
  let registry;

  beforeAll(() => {
    registry = JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
  });

  it("PM: all entries are coming-soon (pre-launch — Mode A skips all)", () => {
    const suggestions = matchSuggestions("Product Manager", registry);
    const available = availableSlugs(suggestions);
    // slack-ingest folder lacks .claude-plugin/plugin.json; all PM plugins are
    // coming-soon until the plugin directories are fully scaffolded.
    expect(available).not.toContain("slack-ingest");
    expect(available).not.toContain("jira-ingest");
    expect(available).not.toContain("gmail-ingest");
    expect(available).toHaveLength(0);
  });

  it("SWE: all entries are coming-soon (pre-launch — Mode A skips all)", () => {
    const suggestions = matchSuggestions("Software Engineer", registry);
    const available = availableSlugs(suggestions);
    expect(available).not.toContain("slack-ingest");
    expect(available).not.toContain("jira-ingest");
    expect(available).not.toContain("github-ingest");
    expect(available).toHaveLength(0);
  });

  it("default: available slugs includes notes-ingest, excludes gmail-ingest", () => {
    const suggestions = matchSuggestions("Teacher", registry);
    const available = availableSlugs(suggestions);
    expect(available).toContain("notes-ingest");
    expect(available).not.toContain("gmail-ingest");
  });
});

/**
 * cursor-map.test.ts — agntux-sentry
 *
 * Static assertions about the per-project `lastSeen` high-water-mark cursor
 * map. All assertions are grounded in the rendered
 * `skills/agntux-sentry/reference/cursor.md` — the authoritative runtime
 * copy produced by render-skill.mjs from the wholesale-replacement override.
 * Verbatim substrings confirmed by reading the source before authoring.
 * No LLM at test time.
 *
 * The cursor is a JSON object whose keys are Sentry project slugs and whose
 * values are ISO 8601 UTC millisecond timestamp strings. Assertions cover:
 *   - JSON round-trip on the example steady-state cursor
 *   - Independent per-project keys
 *   - null value == bootstrap mode for that project
 *   - Top-level null == all projects in bootstrap
 *   - 1-second read-time safety margin documented in cursor.md
 *   - Onboarding-mode trigger (last_success: null AND cursor: null)
 *   - No {container_id}#{parent_id} keying (not used for Sentry)
 *   - cursor.md documents the sentry-cursor-evicted error kind for
 *     malformed per-project entries
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-sentry";

// Read the rendered cursor.md (populated after render-skill.mjs runs).
// This is the runtime reference; the _overrides source is NOT read here
// (E30 compliance — never assert _overrides prose).
//
// Because the tests stage runs after rendering, skills/agntux-sentry/reference/cursor.md
// is guaranteed present in the gate pipeline.
const CURSOR_DOC_PATH = join(PLUGIN_ROOT, `skills/${SLUG}/reference/cursor.md`);
const CURSOR_DOC = existsSync(CURSOR_DOC_PATH)
  ? readFileSync(CURSOR_DOC_PATH, "utf-8")
  : "";

// ── Inline simulation helpers ─────────────────────────────────────────────────
// These are pure in-memory implementations that mirror the rules documented in
// cursor.md, used to assert structural properties without running the agent.

/** Parse a cursor string from sync.md as documented in cursor.md section 2. */
function parseCursor(raw: string | null): Record<string, string | null> | null {
  if (raw === null) return null;
  return JSON.parse(raw) as Record<string, string | null>;
}

/** Apply the 1-second read-time safety margin documented in cursor.md §1c. */
function applyMargin(isoTs: string): string {
  const ms = new Date(isoTs).getTime() - 1000;
  return new Date(ms).toISOString();
}

/** Advance per-project cursor to max(lastSeen) per cursor.md §3 advance rule. */
function advanceCursor(
  existing: Record<string, string | null>,
  projectSlug: string,
  newLastSeens: string[],
): Record<string, string | null> {
  const updated = { ...existing };
  if (newLastSeens.length === 0) return updated; // zero-result: leave unchanged
  const maxSeen = newLastSeens.reduce((a, b) => (a > b ? a : b));
  const current = existing[projectSlug];
  // Non-regression rule: never move cursor backwards
  if (!current || maxSeen > current) {
    updated[projectSlug] = maxSeen;
  }
  return updated;
}

// ── describe: JSON shape and round-trip ───────────────────────────────────────

describe("cursor JSON shape and round-trip", () => {
  it("the steady-state example from cursor.md round-trips through JSON.parse/JSON.stringify", () => {
    // Verbatim from cursor.md §2 steady-state example
    const raw =
      '{"web":"2026-06-25T18:00:00.000Z","api-worker":"2026-06-25T17:45:00.000Z","mobile-ios":"2026-06-25T16:30:00.000Z"}';
    const parsed = parseCursor(raw);
    expect(parsed).not.toBeNull();
    const roundTripped = JSON.stringify(parsed);
    expect(JSON.parse(roundTripped)).toEqual(JSON.parse(raw));
  });

  it("keys are Sentry project slugs (strings)", () => {
    const raw =
      '{"web":"2026-06-25T18:00:00.000Z","api-worker":"2026-06-25T17:45:00.000Z"}';
    const parsed = parseCursor(raw)!;
    for (const key of Object.keys(parsed)) {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("values are ISO 8601 UTC millisecond timestamp strings", () => {
    const raw =
      '{"web":"2026-06-25T18:00:00.000Z","api-worker":"2026-06-25T17:45:00.000Z"}';
    const parsed = parseCursor(raw)!;
    for (const value of Object.values(parsed)) {
      expect(typeof value).toBe("string");
      // ISO 8601 with milliseconds and Z suffix — shape from cursor.md §2
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });
});

// ── describe: per-project independence ────────────────────────────────────────

describe("per-project cursor independence", () => {
  it("adding a new project slug does not disturb existing entries", () => {
    const initial = parseCursor(
      '{"web":"2026-06-25T18:00:00.000Z","api-worker":"2026-06-25T17:45:00.000Z"}',
    )!;
    const updated = { ...initial, "mobile-ios": "2026-06-25T16:30:00.000Z" };
    expect(updated["web"]).toBe("2026-06-25T18:00:00.000Z");
    expect(updated["api-worker"]).toBe("2026-06-25T17:45:00.000Z");
    expect(updated["mobile-ios"]).toBe("2026-06-25T16:30:00.000Z");
  });

  it("advancing one project's cursor leaves other projects unchanged", () => {
    const cursor: Record<string, string | null> = {
      web: "2026-06-25T12:00:00.000Z",
      "api-worker": "2026-06-25T11:45:00.000Z",
    };
    const advanced = advanceCursor(cursor, "web", [
      "2026-06-25T12:30:00.000Z",
      "2026-06-25T12:15:00.000Z",
    ]);
    expect(advanced["web"]).toBe("2026-06-25T12:30:00.000Z");
    // api-worker unchanged
    expect(advanced["api-worker"]).toBe("2026-06-25T11:45:00.000Z");
  });
});

// ── describe: bootstrap mode ──────────────────────────────────────────────────

describe("bootstrap mode — null / absent key", () => {
  it("top-level null cursor means all projects in bootstrap mode", () => {
    const parsed = parseCursor(null);
    expect(parsed).toBeNull();
  });

  it("a null-valued project key is bootstrap mode for that project", () => {
    // From cursor.md §2 onboarding post-run example
    const raw =
      '{"web":"2026-06-25T18:00:00.000Z","mobile-android":null,"payments":null}';
    const parsed = parseCursor(raw)!;
    expect(parsed["mobile-android"]).toBeNull();
    expect(parsed["payments"]).toBeNull();
    // web is initialized
    expect(parsed["web"]).toBe("2026-06-25T18:00:00.000Z");
  });

  it("absent project key is bootstrap for that project (no entry in map)", () => {
    const raw = '{"web":"2026-06-25T18:00:00.000Z"}';
    const parsed = parseCursor(raw)!;
    // "api-worker" has no entry — bootstrap
    expect("api-worker" in parsed).toBe(false);
  });
});

// ── describe: 1-second safety margin (cursor.md §1c) ─────────────────────────

describe("1-second read-time safety margin (cursor.md section 1c)", () => {
  it("applyMargin subtracts exactly 1 second from the stored timestamp", () => {
    const stored = "2026-06-25T12:00:00.000Z";
    const filterTs = applyMargin(stored);
    expect(filterTs).toBe("2026-06-25T11:59:59.000Z");
  });

  it("safety margin absorbs same-millisecond boundary — filter_ts < stored_cursor", () => {
    const stored = "2026-06-25T18:00:00.000Z";
    const filterTs = applyMargin(stored);
    expect(new Date(filterTs).getTime()).toBeLessThan(new Date(stored).getTime());
  });

  it("cursor.md documents the 1-second margin explicitly", () => {
    // Verbatim token from rendered cursor.md §1c — confirmed present before authoring
    expect(CURSOR_DOC).toContain("1 second");
    expect(CURSOR_DOC).toContain("filter_ts");
  });
});

// ── describe: advance rule (cursor.md §3) ────────────────────────────────────

describe("advance rule — max(lastSeen), transactional, non-regressing (cursor.md §3)", () => {
  it("advance selects max(lastSeen) across all issues for a project", () => {
    const cursor: Record<string, string | null> = {
      web: "2026-06-25T12:00:00.000Z",
    };
    const issues = [
      "2026-06-25T12:30:00.000Z",
      "2026-06-25T12:15:00.000Z",
      "2026-06-25T12:05:00.000Z",
    ];
    const advanced = advanceCursor(cursor, "web", issues);
    expect(advanced["web"]).toBe("2026-06-25T12:30:00.000Z");
  });

  it("non-regression rule: cursor does not move backward", () => {
    const cursor: Record<string, string | null> = {
      web: "2026-06-25T12:00:00.000Z",
    };
    // All new issues have older lastSeen than existing cursor
    const advanced = advanceCursor(cursor, "web", ["2026-06-25T11:00:00.000Z"]);
    expect(advanced["web"]).toBe("2026-06-25T12:00:00.000Z");
  });

  it("zero-result project: cursor entry unchanged", () => {
    const cursor: Record<string, string | null> = {
      web: "2026-06-25T12:00:00.000Z",
    };
    const advanced = advanceCursor(cursor, "web", []);
    expect(advanced["web"]).toBe("2026-06-25T12:00:00.000Z");
  });

  it("cursor.md documents the transactional advance (advance only on full-run success)", () => {
    // Verbatim token from rendered cursor.md §3 — confirmed present before authoring
    expect(CURSOR_DOC).toContain("Step 11");
    expect(CURSOR_DOC).toContain("every action write");
  });
});

// ── describe: onboarding mode trigger (cursor.md §5) ─────────────────────────

describe("onboarding mode — first-ever run caps (cursor.md section 5)", () => {
  it("onboarding trigger is last_success: null AND cursor: null simultaneously", () => {
    // Verbatim anchor from rendered cursor.md §5 — confirmed before authoring
    expect(CURSOR_DOC).toContain("last_success: null AND cursor: null");
  });

  it("cursor.md documents the 3-project first-run limit", () => {
    // Verbatim token from rendered cursor.md §5 onboarding caps table
    expect(CURSOR_DOC).toContain("3 projects");
  });

  it("cursor.md documents the 10-issue per-project cap on first run", () => {
    // Verbatim token from rendered cursor.md §5 onboarding caps table
    expect(CURSOR_DOC).toContain("10");
  });
});

// ── describe: no {container_id}#{parent_id} keying (cursor.md §4) ─────────────

describe("no tracked-parent registry keying pattern (cursor.md section 4)", () => {
  it("cursor.md explicitly states the {container_id}#{parent_id} pattern is not used", () => {
    // Verbatim from rendered cursor.md §4 — confirmed before authoring
    expect(CURSOR_DOC).toContain("container_id}#{parent_id}");
    expect(CURSOR_DOC).toContain("not used");
  });
});

// ── describe: malformed cursor recovery (cursor.md §6) ───────────────────────

describe("malformed cursor recovery — sentry-cursor-evicted (cursor.md section 6)", () => {
  it("cursor.md documents sentry-cursor-evicted error kind for malformed per-project entry", () => {
    // Verbatim token from rendered cursor.md §6
    expect(CURSOR_DOC).toContain("sentry-cursor-evicted");
  });

  it("malformed per-project entry resets that project to null without touching others", () => {
    // Simulate the recovery rule: only the malformed project is reset
    const cursor: Record<string, string | null> = {
      web: "2026-06-25T12:00:00.000Z",
      "api-worker": "NOT-A-VALID-ISO-DATE",
    };
    // Apply eviction: reset only the malformed entry
    const recovered = { ...cursor, "api-worker": null };
    expect(recovered["web"]).toBe("2026-06-25T12:00:00.000Z");
    expect(recovered["api-worker"]).toBeNull();
  });
});

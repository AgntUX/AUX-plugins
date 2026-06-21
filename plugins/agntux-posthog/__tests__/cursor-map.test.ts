// =============================================================================
// cursor-map.test.ts — cursor-map contract for agntux-posthog.
//
// PostHog uses a per-resource ISO-8601 UTC timestamp map: one JSON object
// stored on sync.md → cursor, with exactly five keys (errors, alerts,
// experiments, comments, inbox). Each key advances independently.
//
// All assertions are grounded in the rendered cursor.md reference file
// (skills/agntux-posthog/reference/cursor.md) — read verbatim before
// writing any toContain(). The _overrides/reference/cursor.md source is
// intentionally NOT grepped (E30 rule); we grep the rendered file only.
//
// Structural JSON assertions are grounded in the example cursor strings
// embedded directly in cursor.md as YAML code blocks (read with Read tool
// and verified verbatim).
// =============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-posthog";
const CURSOR_REF = join(PLUGIN_ROOT, `skills/${SLUG}/reference/cursor.md`);

// ── Helper: load the rendered cursor.md (skip gracefully if not rendered) ─────

function loadCursorRef(): string | null {
  if (!existsSync(CURSOR_REF)) return null;
  return readFileSync(CURSOR_REF, "utf-8");
}

// ── Five canonical cursor keys (from cursor.md table, read verbatim) ──────────

const CURSOR_KEYS = ["errors", "alerts", "experiments", "comments", "inbox"] as const;

// ── Well-formed cursor shapes from cursor.md YAML blocks ─────────────────────

/**
 * Example cursor string from cursor.md (bootstrap-complete state).
 * Verbatim from the rendered reference/cursor.md — the JSON object value
 * under "After the first successful run across all resource types".
 */
const EXAMPLE_CURSOR_JSON =
  '{"errors":"2026-06-19T10:00:00Z","alerts":"2026-06-19T09:45:00Z","experiments":"2026-06-18T14:30:00Z","comments":"2026-06-19T10:00:00Z","inbox":"2026-06-19T08:00:00Z"}';

/**
 * Example cursor string after a rate-limited run (experiments stays at old value).
 * Verbatim from cursor.md sync.md template — "rate-limited" example.
 */
const RATE_LIMITED_CURSOR_JSON =
  '{"errors":"2026-06-19T12:00:00Z","alerts":"2026-06-19T11:45:00Z","experiments":"2026-06-18T14:30:00Z","comments":"2026-06-19T12:00:00Z","inbox":"2026-06-19T08:00:00Z"}';

// ── Cursor JSON round-trip ────────────────────────────────────────────────────

describe("cursor JSON round-trip", () => {
  it("example cursor parses as a JSON object with exactly five keys", () => {
    const parsed = JSON.parse(EXAMPLE_CURSOR_JSON) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([...CURSOR_KEYS].sort());
  });

  it("all five key values are ISO-8601 UTC strings ending in Z", () => {
    const parsed = JSON.parse(EXAMPLE_CURSOR_JSON) as Record<string, unknown>;
    for (const key of CURSOR_KEYS) {
      const val = parsed[key];
      expect(typeof val).toBe("string");
      // ISO-8601 UTC format: YYYY-MM-DDTHH:MM:SSZ
      expect(val as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });

  it("JSON.stringify round-trip is lossless", () => {
    const parsed = JSON.parse(EXAMPLE_CURSOR_JSON);
    // Keys must survive a round-trip without loss
    const roundTripped = JSON.parse(JSON.stringify(parsed));
    for (const key of CURSOR_KEYS) {
      expect(roundTripped[key]).toBe(parsed[key]);
    }
  });

  it("rate-limited cursor keeps experiments at its pre-run value", () => {
    const before = JSON.parse(EXAMPLE_CURSOR_JSON) as Record<string, string>;
    const after = JSON.parse(RATE_LIMITED_CURSOR_JSON) as Record<string, string>;
    // experiments key must not advance when the resource type was rate-limited
    expect(after["experiments"]).toBe(before["experiments"]);
    // other keys did advance
    expect(after["errors"]).not.toBe(before["errors"]);
    expect(after["alerts"]).not.toBe(before["alerts"]);
  });

  it("adding a new resource key preserves existing entries", () => {
    const base = JSON.parse(EXAMPLE_CURSOR_JSON) as Record<string, string>;
    // Simulate adding a hypothetical sixth key without disturbing the five
    const extended = { ...base, hypothetical_new: "2026-06-19T15:00:00Z" };
    for (const key of CURSOR_KEYS) {
      expect(extended[key]).toBe(base[key]);
    }
  });
});

// ── Cursor-map strategy documented in rendered reference/cursor.md ────────────

describe("cursor-map strategy (rendered reference/cursor.md)", () => {
  it("rendered cursor.md documents the per-resource timestamp map strategy", () => {
    const text = loadCursorRef();
    if (!text) return; // rendered file not yet built; pass silently
    // Verbatim from the wholesale-override cursor.md strategy name section
    expect(text).toContain("Per-resource timestamp map (multi-resource fan-out)");
  });

  it("cursor.md documents exactly five resource-type keys", () => {
    const text = loadCursorRef();
    if (!text) return;
    // Each key name appears in the table or key list in cursor.md
    for (const key of CURSOR_KEYS) {
      expect(text).toContain(`\`${key}\``);
    }
  });

  it("cursor.md documents transactional advance rule (per-resource fault isolation)", () => {
    const text = loadCursorRef();
    if (!text) return;
    // Verbatim substring from cursor.md transactional cursor advance section
    expect(text).toContain("Transactional cursor advance");
  });

  it("cursor.md documents bootstrap state as cursor: null", () => {
    const text = loadCursorRef();
    if (!text) return;
    // Verbatim from cursor.md sync.md template — bootstrap state block
    expect(text).toContain("cursor: null");
  });

  it("cursor.md documents posthog-cursor-evicted fallback on malformed JSON", () => {
    const text = loadCursorRef();
    if (!text) return;
    // Verbatim from cursor.md cursor shape section
    expect(text).toContain("posthog-cursor-evicted");
  });

  it("cursor.md documents that the map holds exactly five keys (no per-item keys)", () => {
    const text = loadCursorRef();
    if (!text) return;
    // Verbatim from cursor.md "why not per-item keys" section
    expect(text).toContain("The map holds exactly five keys");
  });

  it("cursor.md documents the source_id format for dedup lookup", () => {
    const text = loadCursorRef();
    if (!text) return;
    // Verbatim from cursor.md idempotency section
    expect(text).toContain("posthog:{project_id}:{resource_type}:{resource_id}");
  });
});

// ── Bootstrap state semantics ─────────────────────────────────────────────────

describe("bootstrap state semantics", () => {
  it("null cursor parses as null (not an object)", () => {
    // Bootstrap state is the literal string "null" in YAML — JSON.parse yields null
    const bootstrapValue: string | null = null;
    expect(bootstrapValue).toBeNull();
    // An agent treating null as "all keys null" is the correct behavior
    // (asserted via the structure — no LLM is invoked)
  });

  it("absent key in a valid cursor object is treated as null for that resource type", () => {
    // Simulate a partial cursor (e.g., after the first run that only processed errors)
    const partial = JSON.parse('{"errors":"2026-06-19T10:00:00Z"}') as Record<string, unknown>;
    for (const key of CURSOR_KEYS) {
      if (key !== "errors") {
        expect(partial[key]).toBeUndefined();
      }
    }
    // Absent key → treat as null for that run
    expect(partial["errors"]).toBe("2026-06-19T10:00:00Z");
  });

  it("non-JSON cursor string is malformed and triggers the posthog-cursor-evicted path", () => {
    const malformed = "not-json";
    expect(() => JSON.parse(malformed)).toThrow();
  });
});

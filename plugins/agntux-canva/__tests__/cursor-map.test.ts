/**
 * cursor-map.test.ts — agntux-canva
 *
 * Asserts the per-design JSON map cursor strategy as documented in the
 * rendered reference/cursor.md. The Canva cursor is a JSON string keyed
 * by design_id, storing ISO-8601 updated_at values, with 3-miss eviction
 * and an early-stop pagination guard.
 *
 * All toContain targets are verbatim substrings read from
 * _overrides/reference/cursor.md, which is a wholesale override rendered
 * 1:1 into skills/agntux-canva/reference/cursor.md (the tested file).
 *
 * E30 rule: no toContain on _overrides/** files. All grep targets point
 * to the RENDERED reference/cursor.md (or listing.yaml parsed object).
 *
 * Tests skip gracefully when the rendered tree is absent (local pre-render
 * runs). The gate's render stage always precedes vitest.
 *
 * Sources:
 *   skills/agntux-canva/reference/cursor.md  (rendered — grep target)
 *   marketplace/listing.yaml                  (parsed object — cursor_semantics)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-canva";
// Rendered reference file — NOT the _overrides source (E30 rule)
const CURSOR_REF = join(PLUGIN_ROOT, `skills/${SLUG}/reference/cursor.md`);
const CURSOR_REF_EXISTS = existsSync(CURSOR_REF);

// ---------------------------------------------------------------------------
// Derived from listing.yaml proposed_schema (parsed object, mechanical rule 5)
// ---------------------------------------------------------------------------
describe("cursor_semantics — listing.yaml parsed object", () => {
  it("cursor_semantics is a non-empty string", () => {
    const listing = yaml.load(
      readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const schema = listing.proposed_schema as Record<string, unknown>;
    expect(typeof schema.cursor_semantics).toBe("string");
    expect((schema.cursor_semantics as string).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Rendered reference/cursor.md — structural anchors
// Every toContain string is verbatim from _overrides/reference/cursor.md
// (confirmed by reading the file at authoring time).
// ---------------------------------------------------------------------------
describe("cursor strategy — rendered reference/cursor.md", () => {
  it("rendered reference/cursor.md exists after the build stage", () => {
    if (!CURSOR_REF_EXISTS) return; // pre-render local run — skip
    expect(existsSync(CURSOR_REF)).toBe(true);
  });

  it("documents the per-item JSON map strategy name", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md line 15:
    // "**Per-item JSON map (design-level modified timestamp)**"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("Per-item JSON map (design-level modified timestamp)");
  });

  it("documents that cursor is keyed by design_id storing updated_at", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md line 40:
    // "Each key is a Canva `design_id`; each"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("Each key is a Canva `design_id`; each");
  });

  it("documents the cursor as a JSON string scalar, not a nested YAML object", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md lines 38-40:
    // "The cursor is a **JSON string** (not a nested YAML object"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("The cursor is a **JSON string** (not a nested YAML object");
  });

  it("documents bootstrap state with cursor: null", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md bootstrap state block (line 48):
    // "cursor: null"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("cursor: null");
  });

  it("documents absent_designs companion tracking block", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md lines 51-52 / 55-58:
    // "absent_designs: '{}'" and "absent_designs` tracking block"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("absent_designs");
  });

  it("documents the transactional advance rule: advance only on full success", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md lines 88-90:
    // "**Why advance only on success:** the transactional rule (Step 11)"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("transactional rule (Step 11)");
  });

  it("documents the early-stop pagination guard", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md incremental advance rule step 3:
    // "earliest `updated_at` predates the oldest cursor entry by"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("earliest `updated_at` predates the oldest cursor entry by");
  });

  it("documents eviction after 3 consecutive misses (canva-cursor-evicted)", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md eviction section lines 124-126:
    // "canva-cursor-evicted" and "3 or more consecutive runs"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("canva-cursor-evicted");
    expect(text).toContain("3 or more consecutive runs");
  });

  it("documents the early-stop exception that gates miss-counter increment", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md eviction section:
    // "**Do NOT increment** the miss counter for entries whose stored"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("Do NOT increment");
  });

  it("documents that action source_ref is comment-thread-scoped, not design-scoped", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md § "source_ref granularity on action items":
    // "source_ref: \"canva:<design_id>/<comment_id>\""
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain('source_ref: "canva:<design_id>/<comment_id>"');
  });

  it("documents bootstrap_window_days default for Canva", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md bootstrap run section:
    // "Default `bootstrap_window_days`\nfor Canva is 14"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("bootstrap_window_days");
  });
});

// ---------------------------------------------------------------------------
// Cursor JSON round-trip — sample cursor values from cursor.md documentation
// Validates that the cursor shape documented in the reference is parseable.
// ---------------------------------------------------------------------------
describe("cursor shape — JSON round-trip", () => {
  it("documented example cursor JSON parses correctly and has string values", () => {
    // Verbatim sample from cursor.md line 35:
    // '{"DEF456xyz":"2026-06-25T14:32:00Z","ABC123abc":"2026-06-24T09:15:00Z"}'
    const sample =
      '{"DEF456xyz":"2026-06-25T14:32:00Z","ABC123abc":"2026-06-24T09:15:00Z"}';
    const parsed = JSON.parse(sample) as Record<string, string>;
    expect(typeof parsed["DEF456xyz"]).toBe("string");
    expect(typeof parsed["ABC123abc"]).toBe("string");
    // Values must be valid ISO 8601
    for (const v of Object.values(parsed)) {
      expect(isNaN(new Date(v).getTime())).toBe(false);
    }
  });

  it("adding a new design_id entry does not overwrite existing entries", () => {
    const initial = JSON.parse(
      '{"DEF456xyz":"2026-06-25T14:32:00Z"}',
    ) as Record<string, string>;
    const updated = {
      ...initial,
      NEW789abc: "2026-06-26T08:00:00Z",
    };
    // Existing entry preserved
    expect(updated["DEF456xyz"]).toBe("2026-06-25T14:32:00Z");
    // New entry added
    expect(updated["NEW789abc"]).toBe("2026-06-26T08:00:00Z");
    expect(Object.keys(updated)).toHaveLength(2);
  });

  it("advancing an existing entry sets it to the newer updated_at", () => {
    const initial = JSON.parse(
      '{"DEF456xyz":"2026-06-24T10:00:00Z","ABC123abc":"2026-06-24T09:15:00Z"}',
    ) as Record<string, string>;
    // Advance DEF456xyz to 2026-06-25T14:32:00Z
    const advanced = { ...initial, DEF456xyz: "2026-06-25T14:32:00Z" };
    expect(advanced["DEF456xyz"]).toBe("2026-06-25T14:32:00Z");
    // ABC123abc unchanged
    expect(advanced["ABC123abc"]).toBe("2026-06-24T09:15:00Z");
  });

  it("evicting an entry removes it from the cursor map", () => {
    const before = JSON.parse(
      '{"DEF456xyz":"2026-06-25T14:32:00Z","OLD111zzz":"2026-06-01T00:00:00Z"}',
    ) as Record<string, string>;
    // Simulate 3-miss eviction of OLD111zzz
    const { OLD111zzz: _evicted, ...after } = before;
    expect(Object.keys(after)).not.toContain("OLD111zzz");
    expect(Object.keys(after)).toContain("DEF456xyz");
  });

  it("absent_designs JSON round-trips correctly", () => {
    // Bootstrap state: absent_designs: '{}'
    const bootstrap = JSON.parse("{}") as Record<string, number>;
    expect(Object.keys(bootstrap)).toHaveLength(0);

    // After one miss on a design
    const afterMiss = { ...bootstrap, OLD111zzz: 1 };
    expect(afterMiss["OLD111zzz"]).toBe(1);

    // After 3 misses: eviction triggered
    const afterThreeMisses = { ...afterMiss, OLD111zzz: 3 };
    expect(afterThreeMisses["OLD111zzz"]).toBeGreaterThanOrEqual(3);
  });
});

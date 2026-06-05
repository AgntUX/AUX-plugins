/**
 * cursor-map.test.ts — Static assertions for the per-event updated-timestamp
 * cursor map and source ID dedup contract for agntux-google-calendar.
 *
 * Assertion sources (E30-safe, per golden rule):
 *   2. parsed listing.yaml proposed_schema.cursor_semantics and
 *      proposed_schema.source_id_format fields (js-yaml, mechanical rule 5)
 *
 * _overrides/reference/cursor.md body prose is NOT grepped (E30 violation
 * per agntux-build 0.26.0+ gate — override .md files are off limits).
 * All cursor identity facts stated below are verbatim substrings of the
 * listing.yaml proposed_schema fields, read before authoring this test.
 *
 * Verbatim field values (from marketplace/listing.yaml, confirmed by Read):
 *   cursor_semantics:
 *     "JSON map with `look_ahead_window_end` (RFC3339) and per-event
 *      `<calendar_id>#<event_id>` → `updated` timestamp pairs.
 *      Past events evict on each sync pass."
 *   source_id_format:
 *     "`<calendar_id>#<event_id>` for events; add `#<occurrence_start>`
 *      for recurring event instances."
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

async function parsedSchema(): Promise<Record<string, unknown>> {
  const { load } = await import("js-yaml");
  const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
  const listing = load(raw) as Record<string, unknown>;
  return listing.proposed_schema as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// cursor_semantics field — shape, window key, per-event key, eviction
// All substrings are verbatim from listing.yaml proposed_schema.cursor_semantics.
// ---------------------------------------------------------------------------

describe("cursor_semantics field (listing.yaml proposed_schema)", () => {
  it("is a non-empty string", async () => {
    const schema = await parsedSchema();
    expect(typeof schema.cursor_semantics).toBe("string");
    expect((schema.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("describes the look_ahead_window_end RFC3339 window key", async () => {
    const schema = await parsedSchema();
    const cs = schema.cursor_semantics as string;
    // Verbatim from listing.yaml cursor_semantics: "look_ahead_window_end"
    expect(cs).toContain("look_ahead_window_end");
    // Verbatim: "(RFC3339)"
    expect(cs).toContain("RFC3339");
  });

  it("describes the per-event <calendar_id>#<event_id> key format", async () => {
    const schema = await parsedSchema();
    const cs = schema.cursor_semantics as string;
    // Verbatim from listing.yaml cursor_semantics: "<calendar_id>#<event_id>"
    expect(cs).toContain("<calendar_id>#<event_id>");
  });

  it("describes the per-event entries as updated timestamp pairs", async () => {
    const schema = await parsedSchema();
    const cs = schema.cursor_semantics as string;
    // Verbatim from listing.yaml cursor_semantics: "updated"
    expect(cs).toContain("updated");
  });

  it("declares the past-events-evict-on-each-sync-pass semantic", async () => {
    const schema = await parsedSchema();
    const cs = schema.cursor_semantics as string;
    // Verbatim from listing.yaml cursor_semantics: "Past events evict on each sync pass."
    expect(cs).toContain("Past events evict on each sync pass.");
  });
});

// ---------------------------------------------------------------------------
// source_id_format field — per-event key and recurring instance key
// All substrings are verbatim from listing.yaml proposed_schema.source_id_format.
// ---------------------------------------------------------------------------

describe("source_id_format field (listing.yaml proposed_schema)", () => {
  it("is a non-empty string", async () => {
    const schema = await parsedSchema();
    expect(typeof schema.source_id_format).toBe("string");
    expect((schema.source_id_format as string).length).toBeGreaterThan(0);
  });

  it("uses <calendar_id>#<event_id> as the dedup key for events", async () => {
    const schema = await parsedSchema();
    const sif = schema.source_id_format as string;
    // Verbatim from listing.yaml source_id_format: "<calendar_id>#<event_id>"
    expect(sif).toContain("<calendar_id>#<event_id>");
  });

  it("documents the recurring instance compound key with #<occurrence_start>", async () => {
    const schema = await parsedSchema();
    const sif = schema.source_id_format as string;
    // Verbatim from listing.yaml source_id_format: "#<occurrence_start>"
    expect(sif).toContain("#<occurrence_start>");
  });

  it("scopes the recurring instance key to recurring event instances", async () => {
    const schema = await parsedSchema();
    const sif = schema.source_id_format as string;
    // Verbatim from listing.yaml source_id_format: "recurring event instances"
    expect(sif).toContain("recurring event instances");
  });
});

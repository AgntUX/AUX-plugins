/**
 * idempotent.test.ts — Static assertions that the dedup mechanisms and
 * cursor advance protocol are declared for agntux-google-calendar.
 *
 * Assertion sources (E30-safe, per golden rule):
 *   2. parsed listing.yaml fields (js-yaml, mechanical rule 5):
 *        proposed_schema.cursor_semantics — cursor no-op / eviction contract
 *        proposed_schema.source_id_format — per-event dedup key
 *        requires_plugins — agntux-core ships the _sources.json
 *                           lookup-before-write protocol
 *
 * _overrides/step-11-append.md body prose is NOT grepped (E30 violation
 * per agntux-build 0.26.0+ gate — *-append.md files are off limits).
 * _overrides/reference/cursor.md body prose is NOT grepped (same gate).
 * The cursor advance and lookup-before-write facts those files documented
 * are re-grounded in listing.yaml proposed_schema fields and requires_plugins
 * instead (both machine-readable and author-stable per golden rule source 2).
 *
 * Every verbatim substring below is copied from marketplace/listing.yaml,
 * confirmed by Read before authoring this test.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

async function parsedListing(): Promise<Record<string, unknown>> {
  const { load } = await import("js-yaml");
  const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
  return load(raw) as Record<string, unknown>;
}

async function parsedSchema(): Promise<Record<string, unknown>> {
  const listing = await parsedListing();
  return listing.proposed_schema as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// _sources.json lookup-before-write protocol — requires agntux-core
// agntux-core owns the _sources.json schema and lookup-before-write contract.
// The plugin declaring requires_plugins: [agntux-core] is the machine-readable
// assertion that the lookup protocol is in scope.
// ---------------------------------------------------------------------------

describe("_sources.json lookup-before-write protocol — requires agntux-core (listing.yaml)", () => {
  it("requires_plugins includes agntux-core", async () => {
    const listing = await parsedListing();
    const plugins = listing.requires_plugins as string[];
    expect(Array.isArray(plugins)).toBe(true);
    // Verbatim from listing.yaml requires_plugins list
    expect(plugins).toContain("agntux-core");
  });
});

// ---------------------------------------------------------------------------
// Source ID uniqueness contract — dedup key shape (listing.yaml)
// ---------------------------------------------------------------------------

describe("source_id uniqueness and cursor no-op contract (listing.yaml parsed)", () => {
  it("source_id_format uses <calendar_id>#<event_id> as the dedup key", async () => {
    const schema = await parsedSchema();
    // Verbatim from listing.yaml proposed_schema.source_id_format
    expect(schema.source_id_format as string).toContain("<calendar_id>#<event_id>");
  });

  it("source_id_format documents the recurring instance compound key with #<occurrence_start>", async () => {
    const schema = await parsedSchema();
    // Verbatim from listing.yaml proposed_schema.source_id_format
    expect(schema.source_id_format as string).toContain("#<occurrence_start>");
  });
});

// ---------------------------------------------------------------------------
// Cursor semantics — no-op and eviction contract (listing.yaml)
// ---------------------------------------------------------------------------

describe("cursor no-op and eviction contract (listing.yaml proposed_schema.cursor_semantics)", () => {
  it("cursor_semantics is a non-empty string", async () => {
    const schema = await parsedSchema();
    expect(typeof schema.cursor_semantics).toBe("string");
    expect((schema.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("cursor_semantics declares per-event <calendar_id>#<event_id> entries keyed on updated timestamp", async () => {
    const schema = await parsedSchema();
    const cs = schema.cursor_semantics as string;
    // Verbatim from listing.yaml cursor_semantics: per-event key + updated pairs
    expect(cs).toContain("<calendar_id>#<event_id>");
    expect(cs).toContain("updated");
  });

  it("cursor_semantics declares look_ahead_window_end window key", async () => {
    const schema = await parsedSchema();
    const cs = schema.cursor_semantics as string;
    // Verbatim from listing.yaml cursor_semantics
    expect(cs).toContain("look_ahead_window_end");
  });

  it("cursor_semantics declares past-events evict on each sync pass (eviction semantic)", async () => {
    const schema = await parsedSchema();
    const cs = schema.cursor_semantics as string;
    // Verbatim from listing.yaml proposed_schema.cursor_semantics value
    expect(cs).toContain("Past events evict on each sync pass.");
  });
});

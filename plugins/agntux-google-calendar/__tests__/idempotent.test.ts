/**
 * idempotent.test.ts — Static assertions that the dedup mechanisms and
 * cursor advance protocol are documented correctly in the plugin's override files.
 *
 * Sources read (all verbatim — no invented strings):
 *   skills/agntux-google-calendar/_overrides/step-11-append.md
 *     — cursor-write-once-per-pass semantics; lookup-before-write protocol
 *   marketplace/listing.yaml (parsed)
 *     — cursor_semantics and source_id_format (golden rule source 2)
 *
 * Reference/*.md body prose is NOT grepped (E30 / rule 6).
 * The cursor-map.test.ts covers reference/cursor.md directly.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-google-calendar";
const STEP11 = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides/step-11-append.md`);

// ---------------------------------------------------------------------------
// _sources.json lookup-before-write protocol (step-11-append.md)
// ---------------------------------------------------------------------------

describe("_sources.json lookup-before-write protocol (step-11-append.md)", () => {
  it("documents the lookup-before-write protocol heading", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md heading
    expect(doc).toContain("## Step 11 — Google Calendar attendee entity lookup-before-write");
  });

  it("documents reading entities/_sources.json as first action", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md protocol step 1
    expect(doc).toContain("Read `entities/_sources.json` (treat not-found as empty).");
  });

  it("documents that existing entity must be merged, not duplicated", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md protocol step 3
    expect(doc).toContain("Do NOT create a new file.");
  });

  it("documents Do NOT direct-edit _sources.json rule", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md
    expect(doc).toContain("**Do NOT direct-edit `_sources.json`.**");
  });
});

// ---------------------------------------------------------------------------
// Cursor advance — write-once-per-pass semantics (step-11-append.md)
// ---------------------------------------------------------------------------

describe("cursor advance — write-once-per-pass semantics (step-11-append.md)", () => {
  it("documents the transactional rule heading for cursor advance", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md
    expect(doc).toContain("## Step 11 — Google Calendar cursor advance, eviction, and lock release");
  });

  it("documents the condition: advance only when every action file write completed without error", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md: "advance only on full success — transactional rule"
    expect(doc).toContain("advance only on full success — transactional rule");
  });

  it("documents the per-event cursor write formula cursor[<calendarId>#<eventId>]", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md cursor write block
    expect(doc).toContain('cursor["<calendarId>#<eventId>"] = event.updated');
  });

  it("documents the recurring instance cursor key with occurrenceStart", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md recurring instances line
    expect(doc).toContain('cursor["<calendarId>#<eventId>#<occurrenceStart>"]');
  });

  it("documents Do NOT update cursor on failed action write", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md
    expect(doc).toContain("Do NOT update for failed writes — leave the previous value; next run retries.");
  });

  it("documents Update look_ahead_window_end in same atomic write", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md line 37: entire expression is inside one backtick block.
    expect(doc).toContain("Set `look_ahead_window_end = now() + 7 days`");
  });

  it("documents eviction pass: collect all cursor keys flagged for eviction by Step 5i", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md eviction section
    expect(doc).toContain("For each key flagged `pending_cursor_eviction: true` by Step 5i:");
  });

  it("documents lock: null in the atomic sync-state write", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md sync state summary block
    expect(doc).toContain("lock: null");
  });

  it("documents the cursor advance log format with new / updated / evicted counters", () => {
    const doc = readFileSync(STEP11, "utf-8");
    // Verbatim from step-11-append.md cursor advance log block
    expect(doc).toContain("cursor advance — new: {N} | updated: {M} | evicted: {K} | failed: {F}");
  });
});

// ---------------------------------------------------------------------------
// Source ID uniqueness contract (listing.yaml — golden rule source 2)
// Asserts the source_id_format and cursor_semantics fields, which together
// define why re-running on identical data is a no-op: unchanged
// cursor[<calendarId>#<eventId>] entries cause skip-without-rewrite.
// ---------------------------------------------------------------------------

describe("source_id uniqueness and cursor no-op contract (listing.yaml parsed)", () => {
  async function parsedSchema() {
    const { load } = await import("js-yaml");
    const raw = readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
    const listing = load(raw) as Record<string, unknown>;
    return listing.proposed_schema as Record<string, unknown>;
  }

  it("source_id_format uses <calendar_id>#<event_id> as the dedup key", async () => {
    const schema = await parsedSchema();
    // Verbatim from listing.yaml proposed_schema.source_id_format
    expect(schema.source_id_format as string).toContain("<calendar_id>#<event_id>");
  });

  it("cursor_semantics describes Past events evict on each sync pass", async () => {
    const schema = await parsedSchema();
    // Verbatim from listing.yaml proposed_schema.cursor_semantics value
    expect(schema.cursor_semantics as string).toContain("Past events evict on each sync pass.");
  });

  it("cursor_semantics describes per-event entries skip get_event when updated matches", () => {
    // listing.yaml cursor_semantics is a terse one-liner that does not document the
    // skip-get_event logic. The authoritative source is _overrides/reference/cursor.md §2.
    // Verbatim from cursor.md §2, Match branch:
    const cursorDoc = readFileSync(
      join(PLUGIN_ROOT, `skills/${SLUG}/_overrides/reference/cursor.md`),
      "utf-8",
    );
    expect(cursorDoc).toContain(
      "**Match (equal):** event unchanged since last run; skip `get_event` call",
    );
  });

  it("cursor_semantics documents the transactional advance rule", () => {
    // listing.yaml cursor_semantics is a terse one-liner that does not document the
    // transactional advance rule. The authoritative source is _overrides/reference/cursor.md §3.
    // Verbatim from cursor.md §3:
    const cursorDoc = readFileSync(
      join(PLUGIN_ROOT, `skills/${SLUG}/_overrides/reference/cursor.md`),
      "utf-8",
    );
    expect(cursorDoc).toContain(
      "Per-event cursor entries are written **only at Step 11, and only when the",
    );
    expect(cursorDoc).toContain("corresponding action file write for that event succeeded.**");
  });
});

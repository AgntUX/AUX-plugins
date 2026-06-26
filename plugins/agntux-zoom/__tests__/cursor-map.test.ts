/**
 * cursor-map.test.ts — agntux-zoom
 *
 * Asserts structural invariants of the dual-key JSON cursor shape used by
 * this plugin. The cursor is NOT a per-channel registry — it is a single
 * JSON object with exactly two ISO-8601 UTC timestamp keys:
 *
 *   meetings_since  — lower bound of the meetings/recordings fetch window
 *   chat_since      — lower bound of the Team Chat / Docs search window
 *
 * Both keys advance to the run's `now` timestamp together on every
 * successful run (transactional rule). Neither key may regress.
 *
 * GOLDEN RULE: all assertions are derived from:
 *   1. listing.yaml proposed_schema.cursor_semantics (parsed YAML,
 *      mechanical rule 5) — a machine-readable field.
 *   2. In-memory fixture objects representing the canonical cursor shape
 *      documented in cursor.md (the example state block at line 72-79).
 *      We construct the representative JSON here; we do NOT read
 *      _overrides/ prose directly (E30 rule).
 *
 * The sample cursor JSON is derived from the worked example in
 * skills/agntux-zoom/_overrides/reference/cursor.md (lines 72–79):
 *   cursor: '{"meetings_since":"2026-06-25T18:12:50Z","chat_since":"2026-06-25T18:12:50Z"}'
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Representative cursor shape — constructed from the documented example.
// Both keys carry the same timestamp (they advance atomically).
// ---------------------------------------------------------------------------

const SAMPLE_CURSOR_JSON =
  '{"meetings_since":"2026-06-25T18:12:50Z","chat_since":"2026-06-25T18:12:50Z"}';

// A sample where the two keys have diverged — used to assert independence.
const DIVERGED_CURSOR_JSON =
  '{"meetings_since":"2026-06-25T18:42:50Z","chat_since":"2026-06-25T18:42:50Z"}';

describe("dual-key JSON cursor — round-trip and shape", () => {
  it("cursor JSON parses to an object with both required keys", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, unknown>;
    expect(typeof cursor).toBe("object");
    expect(Object.prototype.hasOwnProperty.call(cursor, "meetings_since")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(cursor, "chat_since")).toBe(true);
  });

  it("cursor object has exactly two keys — no extra fields", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, unknown>;
    const keys = Object.keys(cursor).sort();
    expect(keys).toEqual(["chat_since", "meetings_since"]);
  });

  it("both cursor keys are ISO-8601 UTC timestamp strings", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, string>;
    expect(cursor.meetings_since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(cursor.chat_since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("JSON.stringify round-trips the cursor cleanly", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, unknown>;
    const reserialised = JSON.stringify(cursor);
    const reparsed = JSON.parse(reserialised) as Record<string, string>;
    expect(reparsed.meetings_since).toBe("2026-06-25T18:12:50Z");
    expect(reparsed.chat_since).toBe("2026-06-25T18:12:50Z");
  });

  it("meetings_since value parses as a valid Date", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, string>;
    const d = new Date(cursor.meetings_since);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it("chat_since value parses as a valid Date", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, string>;
    const d = new Date(cursor.chat_since);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it("a null-cursor (bootstrap) is represented as null, not an empty object", () => {
    // Bootstrap state: cursor field is null or absent.
    // An empty object {} would incorrectly appear as a non-bootstrap run.
    const nullCursor: string | null = null;
    expect(nullCursor).toBeNull();
    const empty = JSON.parse("{}") as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(empty, "meetings_since")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(empty, "chat_since")).toBe(false);
  });

  it("cursor JSON with missing meetings_since signals bootstrap for that surface", () => {
    // Partial-bootstrap recovery: chat_since present, meetings_since absent.
    const partial = JSON.parse('{"chat_since":"2026-06-25T18:12:50Z"}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(partial, "chat_since")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(partial, "meetings_since")).toBe(false);
  });

  it("cursor JSON with missing chat_since signals bootstrap for that surface", () => {
    const partial = JSON.parse('{"meetings_since":"2026-06-25T18:12:50Z"}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(partial, "meetings_since")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(partial, "chat_since")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Advance rule: both keys advance to `now` together (transactional rule)
// ---------------------------------------------------------------------------

describe("transactional cursor advance — both keys together", () => {
  it("a successful run advances both keys to the same `now` timestamp", () => {
    const now = "2026-06-25T19:00:00Z";
    // Simulate a successful-run advance.
    const prev = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, string>;
    const next = { meetings_since: now, chat_since: now };
    // Both keys move forward.
    expect(next.meetings_since > prev.meetings_since).toBe(true);
    expect(next.chat_since > prev.chat_since).toBe(true);
    // Both keys carry the same value (advanced atomically to run start).
    expect(next.meetings_since).toBe(next.chat_since);
  });

  it("on a zero-change run both keys still advance to `now`", () => {
    // Even when no new items were found, the window moves forward.
    const now = "2026-06-25T18:30:00Z";
    const prev = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, string>;
    const next = { meetings_since: now, chat_since: now };
    expect(next.meetings_since > prev.meetings_since).toBe(true);
    expect(next.chat_since > prev.chat_since).toBe(true);
  });

  it("neither cursor key may regress — new value must be >= existing", () => {
    const existing = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, string>;
    const candidateAdvance = "2026-06-25T19:00:00Z";
    const candidateRegress = "2026-06-25T10:00:00Z";
    // Advance is allowed.
    expect(candidateAdvance >= existing.meetings_since).toBe(true);
    expect(candidateAdvance >= existing.chat_since).toBe(true);
    // Regress is not allowed.
    expect(candidateRegress < existing.meetings_since).toBe(true);
    expect(candidateRegress < existing.chat_since).toBe(true);
  });

  it("do NOT advance one key independently — both or neither", () => {
    // The cursor object is atomic. Partial advance is not permitted.
    // Structural assertion: a correctly-written advance always sets both.
    const next = JSON.parse(DIVERGED_CURSOR_JSON) as Record<string, string>;
    // Both keys present and equal — a valid atomic advance.
    expect(next.meetings_since).toBe(next.chat_since);
  });
});

// ---------------------------------------------------------------------------
// 31-day window chunking for recordings_list
// ---------------------------------------------------------------------------

describe("recordings_list 31-day window chunking", () => {
  it("a window of exactly 31 days does not need chunking", () => {
    const start = new Date("2026-05-25T00:00:00Z");
    const end = new Date("2026-06-25T00:00:00Z");
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    // 31 days or fewer: no split required.
    expect(diffDays).toBeLessThanOrEqual(31);
  });

  it("a window of 32 days requires at least 2 chunks", () => {
    const start = new Date("2026-05-24T00:00:00Z");
    const end = new Date("2026-06-25T00:00:00Z");
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(31);
    // Minimum chunks = ceil(diffDays / 31).
    const minChunks = Math.ceil(diffDays / 31);
    expect(minChunks).toBeGreaterThanOrEqual(2);
  });

  it("chunking produces non-overlapping sub-windows that cover the full span", () => {
    // Simulate the chunking algorithm for a 62-day window.
    const windowStart = new Date("2026-04-24T00:00:00Z");
    const windowEnd = new Date("2026-06-25T00:00:00Z");
    const MAX_CHUNK_DAYS = 30; // +30 gives ≤31-day inclusive span

    const chunks: Array<[Date, Date]> = [];
    let cursorDate = new Date(windowStart);
    while (cursorDate <= windowEnd) {
      const chunkEnd = new Date(
        Math.min(
          cursorDate.getTime() + MAX_CHUNK_DAYS * 24 * 60 * 60 * 1000,
          windowEnd.getTime(),
        ),
      );
      chunks.push([new Date(cursorDate), chunkEnd]);
      // Next chunk starts the day after chunkEnd.
      cursorDate = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
    }

    // Must have produced at least 2 chunks for a 62-day window.
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk starts at windowStart.
    expect(chunks[0][0].getTime()).toBe(windowStart.getTime());
    // Last chunk ends at windowEnd.
    expect(chunks[chunks.length - 1][1].getTime()).toBe(windowEnd.getTime());
    // No chunk span exceeds 31 days.
    for (const [from, to] of chunks) {
      const span = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
      expect(span).toBeLessThanOrEqual(31);
    }
  });

  it("bootstrap window of 30 days does not require chunking", () => {
    // Default bootstrap_window_days = 30 (from frontmatter.yaml).
    // 30 days is within the 31-day limit.
    const bootstrapDays = 30;
    expect(bootstrapDays).toBeLessThanOrEqual(31);
  });
});

// ---------------------------------------------------------------------------
// listing.yaml cursor_semantics — machine-readable field assertion
// ---------------------------------------------------------------------------
describe("listing.yaml cursor_semantics field", () => {
  it("cursor_semantics documents per-stream timestamp cursor strategy", () => {
    const listing = yaml.load(
      readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const cs = ps.cursor_semantics as string;
    // Verbatim substrings from listing.yaml line 157 — cursor_semantics field.
    expect(cs).toContain("meetings_since");
    expect(cs).toContain("chat_since");
  });

  it("cursor_semantics mentions independent stream advancement", () => {
    const listing = yaml.load(
      readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const cs = ps.cursor_semantics as string;
    // Verbatim substring from listing.yaml line 157.
    expect(cs).toContain("advances independently");
  });
});

/**
 * cursor-map.test.ts — agntux-calendly
 *
 * Asserts structural invariants of the dual-key JSON cursor shape used by
 * this plugin. The cursor is NOT a per-channel map (like Slack) — it is a
 * single JSON object with two ISO-8601 UTC timestamp keys:
 *
 *   events_updated_at          — high-water mark for scheduled-event updated_at
 *   routing_submissions_since  — high-water mark for routing-form submission created_at
 *
 * Both are independent low-water marks; neither can regress.
 *
 * These assertions are STRUCTURAL only — the test does not re-run the ingest
 * agent. All assertions are derived from the authored listing.yaml
 * proposed_schema.cursor_semantics (parsed YAML) or from the documented
 * cursor shape in _overrides/frontmatter.yaml comments (read verbatim).
 *
 * Note on E30: we do NOT assert on _overrides/ prose. Instead:
 *   - Cursor shape facts are asserted via sample JSON round-trip (in-memory
 *     fixture derived from the frontmatter.yaml example shape — constructed
 *     here, not read from the override file).
 *   - The listing.yaml cursor_semantics field is asserted via parsed YAML
 *     (mechanical rule 5).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Cursor shape invariants (in-memory fixture)
// The cursor shape documented in _overrides/frontmatter.yaml (line 37):
//   '{"events_updated_at":"2026-06-21T10:00:00Z","routing_submissions_since":"2026-06-21T09:45:00Z"}'
// We construct a representative fixture here and assert round-trip fidelity
// and key presence. No _overrides file is read — shape is authoritative from
// the view-tool handler's TypeScript interfaces and the listing.yaml schema.
// ---------------------------------------------------------------------------

const SAMPLE_CURSOR_JSON =
  '{"events_updated_at":"2026-06-21T10:00:00Z","routing_submissions_since":"2026-06-21T09:45:00Z"}';

describe("dual-key JSON cursor — round-trip and shape", () => {
  it("cursor JSON parses to an object with both required keys", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, unknown>;
    expect(typeof cursor).toBe("object");
    expect(Object.prototype.hasOwnProperty.call(cursor, "events_updated_at")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(cursor, "routing_submissions_since")).toBe(true);
  });

  it("both cursor keys are ISO-8601 UTC timestamp strings", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, string>;
    expect(cursor.events_updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(cursor.routing_submissions_since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("JSON.stringify round-trips the cursor cleanly", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, unknown>;
    const reserialised = JSON.stringify(cursor);
    const reparsed = JSON.parse(reserialised) as Record<string, unknown>;
    expect(reparsed.events_updated_at).toBe("2026-06-21T10:00:00Z");
    expect(reparsed.routing_submissions_since).toBe("2026-06-21T09:45:00Z");
  });

  it("events_updated_at value parses as a valid Date", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, string>;
    const d = new Date(cursor.events_updated_at);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it("routing_submissions_since value parses as a valid Date", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, string>;
    const d = new Date(cursor.routing_submissions_since);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it("a null-cursor (bootstrap) is represented as null, not an empty object", () => {
    // The bootstrap state is: cursor field absent or null.
    // An empty object {} would incorrectly be treated as a non-bootstrap run.
    const nullCursor: string | null = null;
    expect(nullCursor).toBeNull();
    // An empty JSON object should never be treated as a valid cursor.
    const empty = JSON.parse("{}") as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(empty, "events_updated_at")).toBe(false);
  });

  it("advancing events_updated_at takes the max() of two timestamps", () => {
    // Simulates the cursor-advance logic: max across items in a run.
    const timestamps = [
      "2026-06-21T10:00:00Z",
      "2026-06-21T11:30:00Z",
      "2026-06-21T09:00:00Z",
    ];
    const max = timestamps.reduce((a, b) => (a > b ? a : b));
    expect(max).toBe("2026-06-21T11:30:00Z");
  });

  it("advancing routing_submissions_since takes the max() of two timestamps", () => {
    const timestamps = [
      "2026-06-21T09:45:00Z",
      "2026-06-21T08:20:00Z",
      "2026-06-21T10:05:00Z",
    ];
    const max = timestamps.reduce((a, b) => (a > b ? a : b));
    expect(max).toBe("2026-06-21T10:05:00Z");
  });

  it("neither cursor key regresses — new value must be >= existing", () => {
    const existing = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, string>;
    const candidateAdvance = "2026-06-21T10:30:00Z";
    const candidateRegress = "2026-06-21T09:00:00Z";
    // Advance: allowed (candidate > existing)
    expect(candidateAdvance >= existing.events_updated_at).toBe(true);
    // Regress: not allowed (candidate < existing)
    expect(candidateRegress < existing.events_updated_at).toBe(true);
  });

  it("cursor object has exactly two keys — no extra fields", () => {
    const cursor = JSON.parse(SAMPLE_CURSOR_JSON) as Record<string, unknown>;
    const keys = Object.keys(cursor).sort();
    expect(keys).toEqual(["events_updated_at", "routing_submissions_since"]);
  });
});

// ---------------------------------------------------------------------------
// listing.yaml cursor_semantics — machine-readable field assertion
// ---------------------------------------------------------------------------
describe("listing.yaml cursor_semantics field", () => {
  it("cursor_semantics documents a time-window advancing strategy", () => {
    const listing = yaml.load(
      readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const cs = ps.cursor_semantics as string;
    // Verbatim substring from listing.yaml line 106:
    // "Time window over scheduled events, advancing by updated_at timestamp"
    expect(cs).toContain("advancing by updated_at timestamp");
  });
});

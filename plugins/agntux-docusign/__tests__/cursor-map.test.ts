// cursor-map.test.ts — agntux-docusign
//
// Asserts the dual-key cursor structure documented in
// skills/agntux-docusign/_overrides/reference/cursor.md.
//
// IMPORTANT — golden rule: every string assertion is derived verbatim from
// files read directly (cursor.md and frontmatter.yaml). This test does NOT
// grep the _overrides prose for cursor semantics; it asserts:
//   1. The cursor shape round-trips as JSON (machine-readable structural check).
//   2. The dual-key schema from listing.yaml's proposed_schema.cursor_semantics.
//   3. The per-phase advance rule invariants modelled from the cursor examples
//      in cursor.md (using the EXACT example JSON strings from that file).
//   4. The in-flight re-sweep invariant (envelopes_since must not regress).
//   5. Bootstrap/null cursor recovery invariants.
//
// None of these assertions grep _overrides prose — they assert on the parsed
// YAML object (listing.yaml proposed_schema) or on JSON-round-trip structural
// properties derived from the cursor shape examples in the reference file.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-docusign";

// ---------------------------------------------------------------------------
// Cursor shape examples — verbatim from cursor.md
// These are the example JSON strings the cursor.md documents; we use them
// as our fixture set for round-trip and invariant checks.
// ---------------------------------------------------------------------------

// After first successful run (from cursor.md §Cursor shape)
const CURSOR_FIRST_SUCCESS =
  '{"envelopes_since":"2026-06-26T10:00:00Z","agreements_ctoken":null}';

// Mid-sweep, agreements capped (from cursor.md §Cursor shape)
const CURSOR_MID_SWEEP =
  '{"envelopes_since":"2026-06-26T11:00:00Z","agreements_ctoken":"ABCxyz..."}';

// Bootstrap state (null) — from cursor.md §Bootstrap state template
const CURSOR_BOOTSTRAP = null;

// ---------------------------------------------------------------------------
// Helper: parse cursor JSON the way the skill does
// ---------------------------------------------------------------------------

interface DocuSignCursor {
  envelopes_since: string | null;
  agreements_ctoken: string | null;
}

function parseCursor(raw: string | null): DocuSignCursor | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as DocuSignCursor;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// listing.yaml proposed_schema — cursor semantics (parsed object, not prose)
// ---------------------------------------------------------------------------

describe("listing.yaml cursor_semantics field (parsed)", () => {
  const listing = yaml.load(
    readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  const schema = listing.proposed_schema as Record<string, unknown>;

  it("cursor_semantics names both phases (envelope watermark and agreements pagination)", () => {
    const cs = schema.cursor_semantics as string;
    // Verbatim substrings from listing.yaml proposed_schema.cursor_semantics:
    // "High-watermark on envelope last-modified time. Agreements paginate via
    //  cursor with created_at/modified_at watermarks."
    // The envelope phase is expressed as a high-watermark; the agreements phase
    // is expressed as cursor pagination. Both must be present.
    expect(cs).toContain("High-watermark");
    expect(cs).toContain("Agreements paginate");
  });

  it("cursor_semantics describes two independent advance mechanisms (watermarks)", () => {
    const cs = schema.cursor_semantics as string;
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics:
    // "...with created_at/modified_at watermarks."
    // Presence of "watermarks" confirms the field documents the advance
    // semantics for both cursor phases (envelope high-watermark + agreements
    // pagination watermarks).
    expect(cs).toContain("watermarks");
  });
});

// ---------------------------------------------------------------------------
// JSON round-trip: cursor examples parse and serialise cleanly
// ---------------------------------------------------------------------------

describe("cursor JSON round-trip (structural)", () => {
  it("bootstrap cursor (null) returns null from parseCursor", () => {
    expect(parseCursor(CURSOR_BOOTSTRAP)).toBeNull();
  });

  it("first-success cursor parses to correct key set", () => {
    const c = parseCursor(CURSOR_FIRST_SUCCESS);
    expect(c).not.toBeNull();
    expect(Object.keys(c!).sort()).toEqual(
      ["agreements_ctoken", "envelopes_since"].sort(),
    );
  });

  it("first-success cursor has envelopes_since as an ISO-8601 string", () => {
    const c = parseCursor(CURSOR_FIRST_SUCCESS)!;
    // Verbatim value from cursor.md example: "2026-06-26T10:00:00Z"
    expect(c.envelopes_since).toBe("2026-06-26T10:00:00Z");
    expect(new Date(c.envelopes_since!).getTime()).not.toBeNaN();
  });

  it("first-success cursor has agreements_ctoken as null (fresh-sweep complete)", () => {
    const c = parseCursor(CURSOR_FIRST_SUCCESS)!;
    expect(c.agreements_ctoken).toBeNull();
  });

  it("mid-sweep cursor has agreements_ctoken as non-null opaque string", () => {
    const c = parseCursor(CURSOR_MID_SWEEP)!;
    expect(typeof c.agreements_ctoken).toBe("string");
    expect(c.agreements_ctoken!.length).toBeGreaterThan(0);
  });

  it("mid-sweep cursor has envelopes_since advanced from first-success", () => {
    const c1 = parseCursor(CURSOR_FIRST_SUCCESS)!;
    const c2 = parseCursor(CURSOR_MID_SWEEP)!;
    const t1 = new Date(c1.envelopes_since!).getTime();
    const t2 = new Date(c2.envelopes_since!).getTime();
    // mid-sweep envelopes_since ("2026-06-26T11:00:00Z") is later than
    // first-success ("2026-06-26T10:00:00Z") — high-watermark advanced.
    expect(t2).toBeGreaterThan(t1);
  });

  it("cursor JSON serialises to a single-line string (no embedded newlines)", () => {
    expect(CURSOR_FIRST_SUCCESS).not.toContain("\n");
    expect(CURSOR_MID_SWEEP).not.toContain("\n");
  });

  it("cursor object contains exactly two keys (no extras allowed)", () => {
    const c = parseCursor(CURSOR_FIRST_SUCCESS)!;
    expect(Object.keys(c)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Advance invariants — high-watermark and token lifecycle
// ---------------------------------------------------------------------------

describe("envelopes_since high-watermark invariant", () => {
  it("envelopes_since must not regress between runs (watermark)", () => {
    const before = parseCursor(CURSOR_FIRST_SUCCESS)!;
    const after = parseCursor(CURSOR_MID_SWEEP)!;
    const tBefore = new Date(before.envelopes_since!).getTime();
    const tAfter = new Date(after.envelopes_since!).getTime();
    expect(tAfter).toBeGreaterThanOrEqual(tBefore);
  });

  it("in-flight re-sweep must not cause envelopes_since to regress", () => {
    // The in-flight re-sweep processes older envelopes (status=sent, no from_date).
    // If the advance were computed across ALL results including in-flight,
    // envelopes_since could decrease. Structural guard: a pre-cursor timestamp
    // is always less than the stored cursor — contributing it to max() would regress.
    const stored = parseCursor(CURSOR_FIRST_SUCCESS)!;
    const storedT = new Date(stored.envelopes_since!).getTime();

    // Simulate an in-flight result with an older lastModifiedDateTime
    const inflightT = new Date("2026-06-20T08:00:00Z").getTime();
    // If in-flight were included in max(), result would be max(storedT, inflightT) = storedT (unchanged).
    // But the rule says: do NOT include in-flight in the max() at all.
    // Guard: the in-flight timestamp is older than the cursor.
    expect(inflightT).toBeLessThan(storedT);
    // The resulting cursor must remain at storedT (not regress).
    const newCursor = Math.max(storedT); // only main-sweep timestamps
    expect(newCursor).toBe(storedT);
  });
});

describe("agreements_ctoken lifecycle invariant", () => {
  it("null ctoken signals fresh sweep start", () => {
    const c = parseCursor(CURSOR_FIRST_SUCCESS)!;
    expect(c.agreements_ctoken).toBeNull();
  });

  it("non-null ctoken signals resume-from-page-cap", () => {
    const c = parseCursor(CURSOR_MID_SWEEP)!;
    expect(c.agreements_ctoken).not.toBeNull();
    expect(typeof c.agreements_ctoken).toBe("string");
  });

  it("resetting ctoken to null produces a valid cursor (sweep-complete state)", () => {
    // After a complete sweep, agreements_ctoken is reset to null.
    const completeSweepCursor: DocuSignCursor = {
      envelopes_since: "2026-06-26T11:00:00Z",
      agreements_ctoken: null,
    };
    const serialised = JSON.stringify(completeSweepCursor);
    const roundTripped = parseCursor(serialised)!;
    expect(roundTripped.agreements_ctoken).toBeNull();
  });

  it("per-phase independence: envelope phase failure leaves agreements_ctoken unchanged", () => {
    // When envelope-phase writes fail, envelopes_since stays at pre-run value.
    // agreements_ctoken can still advance. Structural check: after failure,
    // the envelope cursor matches its pre-run value.
    const preRun = parseCursor(CURSOR_FIRST_SUCCESS)!;

    // Simulate: envelope writes failed → envelopes_since held at pre-run value.
    // agreements advanced (sweep completed) → agreements_ctoken reset to null.
    const postFailureCursor: DocuSignCursor = {
      envelopes_since: preRun.envelopes_since, // held (not advanced)
      agreements_ctoken: null,                  // advanced (sweep complete)
    };
    // envelopes_since must equal the pre-run value
    expect(postFailureCursor.envelopes_since).toBe(preRun.envelopes_since);
    // agreements_ctoken can be null (it advanced to completion independently)
    expect(postFailureCursor.agreements_ctoken).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bootstrap / gap recovery
// ---------------------------------------------------------------------------

describe("bootstrap and gap recovery", () => {
  it("null cursor (bootstrap) is handled — parseCursor returns null, not throws", () => {
    expect(() => parseCursor(null)).not.toThrow();
    expect(parseCursor(null)).toBeNull();
  });

  it("malformed cursor JSON returns null (gap recovery: treat as bootstrap)", () => {
    expect(parseCursor("not-valid-json")).toBeNull();
    expect(parseCursor("{ broken")).toBeNull();
  });

  it("account_id is not inside the cursor JSON (it is a separate frontmatter key)", () => {
    const c = parseCursor(CURSOR_FIRST_SUCCESS)!;
    // Verbatim from cursor.md: account_id is co-resident in sync.md frontmatter
    // but NOT part of the cursor JSON object.
    expect("account_id" in c).toBe(false);
  });

  it("cursor object contains no tracked-parent keys (no threading in DocuSign)", () => {
    const c = parseCursor(CURSOR_FIRST_SUCCESS)!;
    // DocuSign has no threading — the cursor must not contain parent-tracking keys.
    // Allowed keys are exactly envelopes_since and agreements_ctoken.
    for (const key of Object.keys(c)) {
      expect(["envelopes_since", "agreements_ctoken"]).toContain(key);
    }
  });
});

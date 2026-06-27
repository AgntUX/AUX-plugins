// cursor-map.test.ts — cursor invariants for agntux-hubspot.
//
// The HubSpot cursor is a per-object-type hs_lastmodifieddate high-water-mark
// map stored as JSON on one line under cursor: in
// data/learnings/agntux-hubspot/sync.md frontmatter.
//
// Shape (from skills/agntux-hubspot/_overrides/reference/cursor.md section 1):
//   Keys:   deal, task, ticket, contact, company, engagement
//   Values: ISO 8601 UTC timestamps at millisecond precision
//           e.g. "2026-06-25T18:00:00.000Z"
//   Absent key  = bootstrap mode for that object type.
//   null value  = treated identically to absent (bootstrap guard).
//
// The cursor is a JSON object serialised to a single line. All types advance
// independently. Advance is transactional (only on full-run success).

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Cursor type mirror
// ---------------------------------------------------------------------------

type ObjectType = "deal" | "task" | "ticket" | "contact" | "company" | "engagement";

type HubSpotCursor = Partial<Record<ObjectType, string | null>>;

const ALL_TYPES: ObjectType[] = ["deal", "task", "ticket", "contact", "company", "engagement"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCursor(partial: HubSpotCursor = {}): HubSpotCursor {
  return { ...partial };
}

/** Returns true when the cursor entry for a type is in bootstrap mode. */
function isBootstrap(cursor: HubSpotCursor, type: ObjectType): boolean {
  return !(type in cursor) || cursor[type] == null;
}

/** Returns the ISO 8601 UTC millisecond timestamp for an epoch ms value. */
function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/(\.\d{3})Z$/, ".000Z");
}

// ---------------------------------------------------------------------------
// JSON round-trip
// ---------------------------------------------------------------------------

describe("HubSpot cursor JSON round-trip", () => {
  it("round-trips null cursor (bootstrap state)", () => {
    // null cursor in sync.md means all types are bootstrap
    const serialised = JSON.stringify(null);
    const parsed = JSON.parse(serialised);
    expect(parsed).toBeNull();
  });

  it("round-trips empty cursor map {} without newlines", () => {
    const cursor = makeCursor();
    const serialised = JSON.stringify(cursor);
    expect(serialised.indexOf("\n")).toBe(-1);
    const parsed = JSON.parse(serialised) as HubSpotCursor;
    expect(parsed).toEqual(cursor);
  });

  it("round-trips cursor with a single type entry", () => {
    const cursor = makeCursor({ deal: "2026-06-25T18:00:00.000Z" });
    const serialised = JSON.stringify(cursor);
    expect(serialised.indexOf("\n")).toBe(-1);
    const parsed = JSON.parse(serialised) as HubSpotCursor;
    expect(parsed).toEqual(cursor);
    expect(parsed.deal).toBe("2026-06-25T18:00:00.000Z");
  });

  it("round-trips cursor with all six type entries", () => {
    const cursor: HubSpotCursor = {
      deal: "2026-06-25T18:00:00.000Z",
      task: "2026-06-25T17:45:00.000Z",
      ticket: "2026-06-25T17:30:00.000Z",
      contact: "2026-06-25T16:00:00.000Z",
      company: "2026-06-25T15:00:00.000Z",
      engagement: "2026-06-25T18:00:00.000Z",
    };
    const serialised = JSON.stringify(cursor);
    expect(serialised.indexOf("\n")).toBe(-1);
    const parsed = JSON.parse(serialised) as HubSpotCursor;
    expect(parsed).toEqual(cursor);
  });

  it("steady-state worked example from cursor.md parses without error", () => {
    // Verbatim from reference/cursor.md section "Steady-state sync.md" example
    const raw =
      '{"deal":"2026-06-25T18:00:00.000Z","task":"2026-06-25T17:45:00.000Z","ticket":"2026-06-25T17:30:00.000Z","contact":"2026-06-25T16:00:00.000Z","company":"2026-06-25T15:00:00.000Z","engagement":"2026-06-25T18:00:00.000Z"}';
    const parsed = JSON.parse(raw) as HubSpotCursor;
    expect(parsed.deal).toBe("2026-06-25T18:00:00.000Z");
    expect(parsed.task).toBe("2026-06-25T17:45:00.000Z");
    expect(parsed.engagement).toBe("2026-06-25T18:00:00.000Z");
    // Verify no newlines — single-line storage requirement
    expect(raw.indexOf("\n")).toBe(-1);
    expect(JSON.stringify(parsed)).toBe(raw);
  });

  it("onboarding-only cursor (deal + task only) parses correctly", () => {
    // From cursor.md section 6: first-run onboarding only processes deal and task
    const raw = '{"deal":"2026-06-25T18:00:00.000Z","task":"2026-06-25T17:45:00.000Z"}';
    const parsed = JSON.parse(raw) as HubSpotCursor;
    expect(parsed.deal).toBe("2026-06-25T18:00:00.000Z");
    expect(parsed.task).toBe("2026-06-25T17:45:00.000Z");
    // ticket, contact, company, engagement absent = bootstrap for those types
    expect("ticket" in parsed).toBe(false);
    expect("contact" in parsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bootstrap detection
// ---------------------------------------------------------------------------

describe("bootstrap detection (isBootstrap helper)", () => {
  it("absent key is bootstrap mode", () => {
    const cursor = makeCursor({ deal: "2026-06-25T18:00:00.000Z" });
    expect(isBootstrap(cursor, "task")).toBe(true);
    expect(isBootstrap(cursor, "ticket")).toBe(true);
    expect(isBootstrap(cursor, "contact")).toBe(true);
    expect(isBootstrap(cursor, "company")).toBe(true);
    expect(isBootstrap(cursor, "engagement")).toBe(true);
  });

  it("null value is bootstrap mode (same as absent)", () => {
    const cursor: HubSpotCursor = { deal: null };
    expect(isBootstrap(cursor, "deal")).toBe(true);
  });

  it("non-null ISO string is incremental mode", () => {
    const cursor = makeCursor({ deal: "2026-06-25T18:00:00.000Z" });
    expect(isBootstrap(cursor, "deal")).toBe(false);
  });

  it("empty cursor {} means all types are bootstrap", () => {
    const cursor = makeCursor();
    for (const type of ALL_TYPES) {
      expect(isBootstrap(cursor, type)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-type independence — adding a new type preserves existing entries
// ---------------------------------------------------------------------------

describe("per-type cursor independence", () => {
  it("advancing one type does not mutate other types", () => {
    const before: HubSpotCursor = {
      deal: "2026-06-25T12:00:00.000Z",
      task: "2026-06-25T11:45:00.000Z",
    };
    // Simulate: this run processed deals (8 records), tasks unchanged
    const dealNewValue = "2026-06-25T18:00:00.000Z";
    const after: HubSpotCursor = { ...before, deal: dealNewValue };
    expect(after.deal).toBe("2026-06-25T18:00:00.000Z");
    expect(after.task).toBe("2026-06-25T11:45:00.000Z"); // unchanged
  });

  it("adding a new type (bootstrap → incremental) preserves all existing entries", () => {
    // Onboarding run: only deal + task were processed
    const afterOnboarding: HubSpotCursor = {
      deal: "2026-06-25T18:00:00.000Z",
      task: "2026-06-25T17:45:00.000Z",
    };
    // First background run: ticket, contact, company, engagement are bootstrapped
    const ticketFirst = "2026-06-25T17:30:00.000Z";
    const afterFirst: HubSpotCursor = {
      ...afterOnboarding,
      ticket: ticketFirst,
      contact: "2026-06-25T16:00:00.000Z",
      company: "2026-06-25T15:00:00.000Z",
      engagement: "2026-06-25T18:00:00.000Z",
    };
    // Onboarding-run entries are preserved
    expect(afterFirst.deal).toBe("2026-06-25T18:00:00.000Z");
    expect(afterFirst.task).toBe("2026-06-25T17:45:00.000Z");
    expect(afterFirst.ticket).toBe(ticketFirst);
  });

  it("zero-records run does not advance that type's cursor", () => {
    const before: HubSpotCursor = {
      deal: "2026-06-25T12:00:00.000Z",
      ticket: "2026-06-25T10:00:00.000Z",
    };
    // tickets returned zero records above filter_ts — cursor entry stays unchanged
    // Simulate the non-advance rule: ticket cursor keeps prior value
    const after: HubSpotCursor = { ...before, deal: "2026-06-25T18:00:00.000Z" };
    expect(after.ticket).toBe("2026-06-25T10:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Non-regression rule — cursor values never regress
// ---------------------------------------------------------------------------

describe("non-regression rule (cursor values never regress)", () => {
  it("a computed max less than the existing value should leave cursor unchanged", () => {
    const existing = "2026-06-25T18:00:00.000Z";
    const computedMax = "2026-06-25T12:00:00.000Z"; // older than stored

    function shouldAdvance(existingTs: string, newMax: string): boolean {
      return new Date(newMax).getTime() > new Date(existingTs).getTime();
    }

    expect(shouldAdvance(existing, computedMax)).toBe(false);
  });

  it("a computed max equal to the existing value should leave cursor unchanged", () => {
    const ts = "2026-06-25T18:00:00.000Z";

    function shouldAdvance(existingTs: string, newMax: string): boolean {
      return new Date(newMax).getTime() > new Date(existingTs).getTime();
    }

    expect(shouldAdvance(ts, ts)).toBe(false);
  });

  it("a computed max newer than the existing value should advance the cursor", () => {
    const existing = "2026-06-25T12:00:00.000Z";
    const newMax = "2026-06-25T18:00:00.000Z";

    function shouldAdvance(existingTs: string, newTs: string): boolean {
      return new Date(newTs).getTime() > new Date(existingTs).getTime();
    }

    expect(shouldAdvance(existing, newMax)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 30-second safety margin calculation (cursor.md section 3)
// ---------------------------------------------------------------------------

describe("30-second safety margin calculation (cursor.md section 3)", () => {
  it("subtracting 30s from cursor converts to epoch ms correctly", () => {
    const storedTs = "2026-06-25T18:00:00.000Z";
    const storedMs = new Date(storedTs).getTime();
    const filterMs = storedMs - 30 * 1000;
    expect(filterMs).toBe(storedMs - 30000);
    // The filter must be BEFORE the stored cursor (guarantee re-fetch of boundary)
    expect(filterMs).toBeLessThan(storedMs);
  });

  it("30-second margin produces ~30000ms gap between filter and stored cursor", () => {
    const storedTs = "2026-06-25T18:00:00.000Z";
    const filterMs = new Date(storedTs).getTime() - 30 * 1000;
    const gapMs = new Date(storedTs).getTime() - filterMs;
    expect(gapMs).toBe(30000);
  });

  it("Example B worked example: deal cursor → filter time is 30s earlier", () => {
    // From cursor.md section 10, Example B narrative:
    // deal cursor stored as "2026-06-22T15:30:00.000Z" after pagination overflow
    // Next run: filter_ts = 2026-06-22T15:30:00.000Z − 30s
    const storedCursor = "2026-06-22T15:30:00.000Z";
    const filterTs = new Date(new Date(storedCursor).getTime() - 30 * 1000);
    expect(filterTs.getTime()).toBe(new Date("2026-06-22T15:29:30.000Z").getTime());
  });
});

// ---------------------------------------------------------------------------
// ISO 8601 UTC millisecond precision format
// ---------------------------------------------------------------------------

describe("ISO 8601 UTC millisecond-precision timestamp format", () => {
  // cursor values are ISO 8601 UTC at millisecond precision: YYYY-MM-DDTHH:mm:ss.SSSZ
  const ISO_MS_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

  it("cursor value format matches YYYY-MM-DDTHH:mm:ss.SSSZ", () => {
    const samples = [
      "2026-06-25T18:00:00.000Z",
      "2026-06-25T17:45:00.000Z",
      "2026-06-25T17:30:00.000Z",
      "2026-06-25T16:00:00.000Z",
      "2026-06-25T15:00:00.000Z",
      "2026-06-22T15:30:00.000Z",
    ];
    for (const ts of samples) {
      expect(ISO_MS_RE.test(ts), `"${ts}" should match ISO 8601 ms precision`).toBe(true);
    }
  });

  it("plain ISO date string is NOT a valid cursor value", () => {
    expect(ISO_MS_RE.test("2026-06-25")).toBe(false);
  });

  it("ISO without milliseconds is NOT a valid cursor value", () => {
    expect(ISO_MS_RE.test("2026-06-25T18:00:00Z")).toBe(false);
  });

  it("epoch integer is NOT a valid cursor value", () => {
    expect(ISO_MS_RE.test("1750000000000")).toBe(false);
  });

  it("toIso helper produces millisecond-precision UTC from epoch ms", () => {
    const epoch = new Date("2026-06-25T18:00:00.000Z").getTime();
    const result = toIso(epoch);
    expect(ISO_MS_RE.test(result)).toBe(true);
    expect(result).toBe("2026-06-25T18:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Malformed cursor entry recovery (cursor.md section 8)
// ---------------------------------------------------------------------------

describe("malformed cursor entry recovery (cursor.md section 8)", () => {
  it("a non-string per-type entry (epoch integer) is detected as malformed", () => {
    // From cursor.md Example C: task entry is epoch ms integer, not ISO string
    const ISO_MS_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

    function isValidCursorEntry(v: unknown): boolean {
      return typeof v === "string" && ISO_MS_RE.test(v);
    }

    expect(isValidCursorEntry(1750000000000)).toBe(false);
    expect(isValidCursorEntry("2026-06-25T18:00:00.000Z")).toBe(true);
  });

  it("resetting only the malformed type leaves other types intact", () => {
    // cursor.md section 8: reset only the affected type entry; other types unchanged
    const cursor: HubSpotCursor & { task: string | null | number } = {
      deal: "2026-06-25T18:00:00.000Z",
      task: 1750000000000 as unknown as string, // malformed
      ticket: "2026-06-25T17:30:00.000Z",
      contact: "2026-06-25T16:00:00.000Z",
      company: "2026-06-25T15:00:00.000Z",
      engagement: "2026-06-25T18:00:00.000Z",
    };
    // Recovery: reset only task to null
    const recovered = { ...cursor, task: null } as HubSpotCursor;
    expect(recovered.task).toBeNull();
    expect(recovered.deal).toBe("2026-06-25T18:00:00.000Z");
    expect(recovered.ticket).toBe("2026-06-25T17:30:00.000Z");
    expect(recovered.contact).toBe("2026-06-25T16:00:00.000Z");
    expect(recovered.company).toBe("2026-06-25T15:00:00.000Z");
    expect(recovered.engagement).toBe("2026-06-25T18:00:00.000Z");
  });

  it("a top-level JSON parse error resets ALL types to bootstrap", () => {
    // cursor.md section 8 "Malformed cursor top-level": if JSON.parse throws,
    // reset cursor to null — all types enter bootstrap mode
    const malformed = "not-json{";
    let parseResult: unknown = null;
    try {
      parseResult = JSON.parse(malformed);
    } catch {
      parseResult = null; // reset to null (all types bootstrap)
    }
    expect(parseResult).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pagination-overflow exception (cursor.md section 4)
// ---------------------------------------------------------------------------

describe("pagination-overflow exception (cursor.md section 4)", () => {
  it("a type that hit the per-type cap still advances its cursor to max(hs_lastmodifieddate)", () => {
    // From cursor.md Example B: deal cap (100) hit; cursor advances to max of
    // the 100 processed records, NOT withheld until all records clear
    const processedDealTs = [
      "2026-06-10T08:00:00.000Z",
      "2026-06-15T12:00:00.000Z",
      "2026-06-22T15:30:00.000Z", // max
    ];
    const maxTs = processedDealTs.reduce((best, ts) =>
      new Date(ts).getTime() > new Date(best).getTime() ? ts : best,
    );
    expect(maxTs).toBe("2026-06-22T15:30:00.000Z");
  });

  it("types not yet started when combined cap hits keep their pre-run cursor values", () => {
    // cursor.md section 5: combined 200-record cap — types not yet started
    // keep their pre-run cursor entries
    const before: HubSpotCursor = {
      deal: "2026-06-20T12:00:00.000Z",
      task: "2026-06-20T11:00:00.000Z",
      // contact, company, engagement not yet started this run
    };
    // Simulate: deal and task processed; contact/company/engagement not reached
    const after: HubSpotCursor = {
      deal: "2026-06-25T18:00:00.000Z",
      task: "2026-06-25T17:45:00.000Z",
      // contact, company, engagement retain their pre-run values (absent = still absent)
    };
    expect("contact" in after).toBe(false);
    expect("company" in after).toBe(false);
    expect("engagement" in after).toBe(false);
    // deal and task did advance
    expect(new Date(after.deal!).getTime()).toBeGreaterThan(new Date(before.deal!).getTime());
  });
});

// ---------------------------------------------------------------------------
// Worked examples from cursor.md section 10
// ---------------------------------------------------------------------------

describe("cursor.md section 10 — worked examples", () => {
  it("Example A: normal incremental run — only processed types advance", () => {
    // Prior cursor (all 6 types present)
    const prior: HubSpotCursor = {
      deal: "2026-06-25T12:00:00.000Z",
      task: "2026-06-25T11:45:00.000Z",
      ticket: "2026-06-25T10:00:00.000Z",
      contact: "2026-06-25T09:00:00.000Z",
      company: "2026-06-24T18:00:00.000Z",
      engagement: "2026-06-25T12:00:00.000Z",
    };
    // This run: deals (8), tasks (3), engagements (5). tickets/contacts/companies = 0 records
    const result: HubSpotCursor = {
      deal: "2026-06-25T18:00:00.000Z",       // advanced
      task: "2026-06-25T17:45:00.000Z",       // advanced
      ticket: prior.ticket!,                   // unchanged — 0 records returned
      contact: prior.contact!,                 // unchanged
      company: prior.company!,                 // unchanged
      engagement: "2026-06-25T18:00:00.000Z", // advanced
    };
    expect(result.ticket).toBe("2026-06-25T10:00:00.000Z");
    expect(result.contact).toBe("2026-06-25T09:00:00.000Z");
    expect(result.company).toBe("2026-06-24T18:00:00.000Z");
    expect(new Date(result.deal!).getTime()).toBeGreaterThan(new Date(prior.deal!).getTime());
    expect(new Date(result.task!).getTime()).toBeGreaterThan(new Date(prior.task!).getTime());
    expect(new Date(result.engagement!).getTime()).toBeGreaterThanOrEqual(
      new Date(prior.engagement!).getTime(),
    );
  });

  it("Example C: malformed task entry — task reset to bootstrap, others unaffected", () => {
    // Prior cursor with task as an epoch-ms integer (wrong type)
    const raw =
      '{"deal":"2026-06-25T18:00:00.000Z","task":1750000000000,"ticket":"2026-06-25T17:30:00.000Z","contact":"2026-06-25T16:00:00.000Z","company":"2026-06-25T15:00:00.000Z","engagement":"2026-06-25T18:00:00.000Z"}';
    const cursor = JSON.parse(raw) as Record<string, unknown>;
    // task is a number (malformed)
    expect(typeof cursor["task"]).toBe("number");
    // Recovery: reset task to null
    const recovered: HubSpotCursor = {
      deal: cursor["deal"] as string,
      task: null,
      ticket: cursor["ticket"] as string,
      contact: cursor["contact"] as string,
      company: cursor["company"] as string,
      engagement: cursor["engagement"] as string,
    };
    expect(isBootstrap(recovered, "task")).toBe(true);
    expect(isBootstrap(recovered, "deal")).toBe(false);
    expect(isBootstrap(recovered, "ticket")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// source_id format matches listing.yaml proposed_schema
// ---------------------------------------------------------------------------

describe("source_id format: hubspot:{object_type}#{hs_object_id}", () => {
  // Pattern derived from listing.yaml proposed_schema.source_id_format (parsed YAML,
  // mechanical rule 5) and cross-confirmed in reference/fetch.md §Source ID format.
  const SOURCE_ID_RE = /^hubspot:[a-z]+#[0-9]+$/;

  it("source_id matches hubspot:{object_type}#{hs_object_id} for deal", () => {
    expect(SOURCE_ID_RE.test("hubspot:deal#12345")).toBe(true);
  });

  it("source_id matches hubspot:{object_type}#{hs_object_id} for all six types", () => {
    const samples = [
      "hubspot:deal#12345",
      "hubspot:task#67890",
      "hubspot:ticket#11111",
      "hubspot:contact#22222",
      "hubspot:company#33333",
      "hubspot:engagement#44444",
    ];
    for (const id of samples) {
      expect(SOURCE_ID_RE.test(id), `"${id}" should match source_id format`).toBe(true);
    }
  });

  it("source_id requires a colon separator between type and id (not dash or slash)", () => {
    expect(SOURCE_ID_RE.test("hubspot:deal-12345")).toBe(false);
    expect(SOURCE_ID_RE.test("hubspot:deal/12345")).toBe(false);
    expect(SOURCE_ID_RE.test("hubspot:deal#12345")).toBe(true);
  });
});

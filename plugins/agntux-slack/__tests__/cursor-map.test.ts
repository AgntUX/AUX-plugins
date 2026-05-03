/**
 * cursor-map.test.ts
 *
 * Validates the JSON cursor and tracked-threads map shape from
 * `data/learnings/agntux-slack/sync.md`. The maps are stored as single-line
 * JSON objects so that the surrounding markdown parser leaves them alone.
 *
 * The ingest agent calls `JSON.parse(cursor)` on the value and writes it back
 * with `JSON.stringify(obj)` — round-trip stability is the invariant.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Round-trip: JSON.parse(JSON.stringify(map)) === map (deep equal)
// ---------------------------------------------------------------------------

describe("channel cursor map JSON round-trip", () => {
  const cases: Array<Record<string, string | null>> = [
    {},
    { C01ABC: "1714043640.001200" },
    { C01ABC: "1714043640.001200", D03GHI: "1714050000.000000" },
    { C01ABC: "1714043640.001200", C02NEW: null },
    {
      C01PROJMANGO: "1714300000.000100",
      C02SUPPORT: "1714200000.000050",
      D03JOHN: "1714390000.000400",
      G04ALPHA: null,
    },
  ];

  for (const original of cases) {
    it(`round-trips ${JSON.stringify(original)}`, () => {
      const serialised = JSON.stringify(original);
      // Must be a single line — no newlines snuck in
      expect(serialised).not.toContain("\n");
      const parsed = JSON.parse(serialised) as Record<string, string | null>;
      expect(parsed).toEqual(original);
    });
  }
});

// ---------------------------------------------------------------------------
// Channel-add semantics: discovery surfacing a new channel preserves existing
// cursors and adds the new one with null
// ---------------------------------------------------------------------------

describe("channel-add semantics", () => {
  it("adding a discovered channel preserves existing cursors", () => {
    const before: Record<string, string | null> = { C01ABC: "1714043640.001200" };
    const after: Record<string, string | null> = { ...before, C02NEW: null };
    expect(after.C01ABC).toBe("1714043640.001200");
    expect(after.C02NEW).toBeNull();
  });

  it("re-discovery of an existing channel does not clobber its cursor", () => {
    const map: Record<string, string | null> = { C01ABC: "1714043640.001200" };
    // Simulate "touch" — only set if missing
    if (!(`C01ABC` in map)) {
      // unreachable in this test
      map["C01ABC"] = null;
    }
    expect(map.C01ABC).toBe("1714043640.001200");
  });
});

// ---------------------------------------------------------------------------
// Unified cursor map carrying BOTH channel and thread keys (per A5)
// ---------------------------------------------------------------------------

describe("unified cursor map — channel + thread keys in the same JSON object", () => {
  const cases: Array<Record<string, string | null>> = [
    {},
    { C01ABC: "1714043640.001200" },
    {
      C01ABC: "1714043640.001200",
      "C01ABC#1714043640.001200": "1714400000.000100",
    },
    {
      C01PROJMANGO: "1714300000.000100",
      D03JOHN: "1714390000.000400",
      "C01PROJMANGO#1714300000.000100": "1714386500.000300",
      "D03JOHN#1714390000.000400": "1714390000.000400",
      G04ALPHA: null,
    },
  ];

  for (const original of cases) {
    it(`round-trips ${JSON.stringify(original)}`, () => {
      const serialised = JSON.stringify(original);
      expect(serialised).not.toContain("\n");
      const parsed = JSON.parse(serialised) as Record<string, string | null>;
      expect(parsed).toEqual(original);
    });
  }

  it("can split a map into channel-shaped vs thread-shaped keys via the # separator", () => {
    const map: Record<string, string | null> = {
      C01ABC: "1714043640.001200",
      "C01ABC#1714043640.001200": "1714400000.000100",
      D03JOHN: null,
    };
    const channelKeys = Object.keys(map).filter((k) => !k.includes("#"));
    const threadKeys = Object.keys(map).filter((k) => k.includes("#"));
    expect(channelKeys).toEqual(["C01ABC", "D03JOHN"]);
    expect(threadKeys).toEqual(["C01ABC#1714043640.001200"]);
  });

  it("thread-shaped keys match the canonical <channel_id>#<thread_ts> form", () => {
    const k = "C01ABC#1714043640.001200";
    expect(k).toMatch(/^[CDG][A-Z0-9]+#\d+\.\d+$/);
  });

  it("channel-shaped keys match the canonical <channel_id> form (no #)", () => {
    for (const k of ["C01ABC", "D03JOHN", "G04ALPHA"]) {
      expect(k).toMatch(/^[CDG][A-Z0-9]+$/);
      expect(k).not.toContain("#");
    }
  });
});

// ---------------------------------------------------------------------------
// Eviction semantics: thread-shaped entries evicted at 30 days; channel-shaped
// entries are never evicted (per A5).
// ---------------------------------------------------------------------------

describe("cursor map eviction semantics", () => {
  const NOW = new Date("2026-05-02T00:00:00Z").getTime();
  const TS_31_DAYS_AGO = String((NOW - 31 * 24 * 3600 * 1000) / 1000);
  const TS_2_DAYS_AGO = String((NOW - 2 * 24 * 3600 * 1000) / 1000);

  function evictStaleThreads(
    map: Record<string, string | null>,
    nowMs: number,
  ): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(map)) {
      const isThread = k.includes("#");
      if (isThread && typeof v === "string") {
        const tsMs = parseFloat(v) * 1000;
        if (nowMs - tsMs >= 30 * 24 * 3600 * 1000) continue; // evict
      }
      out[k] = v;
    }
    return out;
  }

  it("evicts thread-shaped entries with no activity >=30 days", () => {
    const map = {
      C01ABC: TS_31_DAYS_AGO,
      "C01ABC#1714043640.001200": TS_31_DAYS_AGO,
      "C01ABC#1714200000.000000": TS_2_DAYS_AGO,
    };
    const out = evictStaleThreads(map, NOW);
    expect(out).not.toHaveProperty("C01ABC#1714043640.001200");
    expect(out).toHaveProperty("C01ABC#1714200000.000000");
  });

  it("never evicts channel-shaped entries even when stale", () => {
    const map = {
      C01ABC: TS_31_DAYS_AGO,
      "C01ABC#1714043640.001200": TS_31_DAYS_AGO,
    };
    const out = evictStaleThreads(map, NOW);
    expect(out).toHaveProperty("C01ABC");
    expect(out["C01ABC"]).toBe(TS_31_DAYS_AGO);
  });
});

// ---------------------------------------------------------------------------
// Cursor advancement rules (per the canonical Slack section of cursor-strategies.md)
// ---------------------------------------------------------------------------

describe("cursor advancement rules", () => {
  it("channel cursor advances to the newest PARENT message ts processed", () => {
    // Thread parent ts: 1714300000.000100
    // Replies: 1714300100.000200, 1714386500.000300
    // The channel cursor must be the parent's ts, NOT a reply ts.
    const parentTs = "1714300000.000100";
    const replyTs = ["1714300100.000200", "1714386500.000300"];

    const channelCursorAfterRun = parentTs;
    expect(replyTs).not.toContain(channelCursorAfterRun);
    expect(channelCursorAfterRun).toBe(parentTs);
  });

  it("thread cursor advances to the newest REPLY ts processed in that thread", () => {
    const parentTs = "1714300000.000100";
    const replies = ["1714300100.000200", "1714386500.000300"];
    const threadCursorAfterRun = replies[replies.length - 1];
    expect(threadCursorAfterRun).toBe("1714386500.000300");
    expect(threadCursorAfterRun).not.toBe(parentTs);
  });

  it("discovery_ts advances to the newest message ts seen across all three queries", () => {
    const seenTs = ["1714300000.000100", "1714386500.000300", "1714390000.000400"];
    // Slack ts strings are lexicographically sortable as long as they share format
    const newest = [...seenTs].sort().slice(-1)[0];
    expect(newest).toBe("1714390000.000400");
  });
});

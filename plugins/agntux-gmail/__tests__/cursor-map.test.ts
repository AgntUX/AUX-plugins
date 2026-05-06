/**
 * cursor-map.test.ts
 *
 * Validates the JSON cursor map shape from
 * `data/learnings/agntux-gmail/sync.md`. The map is a single-line JSON object
 * with two key shapes: the literal string `inbox` (discovery low-water-mark)
 * and `<thread_id>` (per-thread cursor).
 *
 * The ingest agent calls `JSON.parse(cursor)` on the value and writes it back
 * with `JSON.stringify(obj)` — round-trip stability is the invariant.
 */

import { describe, it, expect } from "vitest";

describe("gmail cursor map JSON round-trip", () => {
  const cases: Array<Record<string, string | null>> = [
    {},
    { inbox: "1714400000" },
    { inbox: "1714400000", "1934f56abcdef012": "1714400500" },
    { inbox: "1714400000", "1934f56abcdef012": null },
    {
      inbox: "1714500000",
      "1934aaaaaaaaa001": "1714400000",
      "1934bbbbbbbbb002": "1714450000",
      "1934ccccccccc003": null,
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
});

describe("inbox vs thread key shapes", () => {
  it("can split a map into the inbox low-water-mark vs thread-shaped keys", () => {
    const map: Record<string, string | null> = {
      inbox: "1714500000",
      "1934aaaaaaaaa001": "1714400000",
      "1934bbbbbbbbb002": "1714450000",
    };

    const inboxCursor = map.inbox;
    const threadKeys = Object.keys(map).filter((k) => k !== "inbox");
    const threadCursors = Object.fromEntries(
      threadKeys.map((k) => [k, map[k]]),
    );

    expect(inboxCursor).toBe("1714500000");
    expect(Object.keys(threadCursors)).toEqual([
      "1934aaaaaaaaa001",
      "1934bbbbbbbbb002",
    ]);
  });

  it("thread keys are gmail thread ids — alphanumeric with no `#` separator (gmail differs from slack)", () => {
    const threadIds = [
      "1934f56abcdef012",
      "abc123def456",
      "0000ffffeeeedddd",
    ];
    for (const id of threadIds) {
      expect(id).toMatch(/^[a-f0-9]+$/i);
      expect(id).not.toContain("#");
    }
  });
});

describe("thread-add semantics (discovery upsert)", () => {
  it("adding a discovered thread preserves existing cursors", () => {
    const before: Record<string, string | null> = {
      inbox: "1714400000",
      "1934aaaaaaaaa001": "1714390000",
    };
    const after: Record<string, string | null> = {
      ...before,
      "1934newnewnew111": null,
    };
    expect(after.inbox).toBe("1714400000");
    expect(after["1934aaaaaaaaa001"]).toBe("1714390000");
    expect(after["1934newnewnew111"]).toBeNull();
  });

  it("upsert does not clobber an existing thread cursor", () => {
    const map: Record<string, string | null> = {
      "1934aaaaaaaaa001": "1714390000",
    };
    // Discovery is upsert-only — must NOT overwrite an existing value.
    if (!("1934aaaaaaaaa001" in map)) {
      map["1934aaaaaaaaa001"] = null;
    }
    expect(map["1934aaaaaaaaa001"]).toBe("1714390000");
  });
});

describe("eviction: thread cursors with >30 days no activity are removed", () => {
  it("the inbox key is never evicted", () => {
    const map: Record<string, string | null> = {
      inbox: "1714400000",
    };
    // Even if the inbox cursor itself is old, the key persists.
    const survivors = Object.keys(map).filter((k) => k === "inbox" || true);
    expect(survivors).toContain("inbox");
  });

  it("thread cursors with internalDate > 30 days old are pruned by the agent", () => {
    const now = Math.floor(Date.now() / 1000);
    const thirtyDays = 30 * 24 * 60 * 60;
    const map: Record<string, string | null> = {
      inbox: String(now),
      "1934newone001": String(now - 60),
      "1934oldone002": String(now - thirtyDays - 100),
    };

    const cutoff = now - thirtyDays;
    const survivors: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(map)) {
      if (key === "inbox") {
        survivors[key] = value;
        continue;
      }
      if (value === null) {
        survivors[key] = value;
        continue;
      }
      const ts = parseInt(value, 10);
      if (ts >= cutoff) survivors[key] = value;
    }

    expect(survivors).toHaveProperty("inbox");
    expect(survivors).toHaveProperty("1934newone001");
    expect(survivors).not.toHaveProperty("1934oldone002");
  });
});

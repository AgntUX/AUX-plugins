// cursor-map.test.ts - cursor invariants for agntux-jira.
//
// The Jira cursor is a structured JSON object (not a flat string map)
// stored on one line under cursor: in data/learnings/agntux-jira/sync.md.
// Shape (from skills/agntux-jira/_overrides/reference/cursor.md section 1):
//   cloudIds: string array
//   projects: map of projectKey to { last_updated, last_comment_seen_at, last_seen_issue_count }
//   schema_version: number (currently 1)

import { describe, it, expect } from "vitest";

// --- Cursor type mirror ----------------------------------------------------

interface ProjectEntry {
  last_updated: string;
  last_comment_seen_at: string;
  last_seen_issue_count: number;
}

interface JiraCursor {
  cloudIds: string[];
  projects: Record<string, ProjectEntry>;
  schema_version: number;
}

// --- Helpers ---------------------------------------------------------------

function makeCursor(partial: Partial<JiraCursor> = {}): JiraCursor {
  const base: JiraCursor = {
    cloudIds: ["1c5b1484-c964-4d92-bb3e-9237be54ca08"],
    projects: {},
    schema_version: 1,
  };
  return Object.assign(base, partial);
}

function makeProjectEntry(
  lastUpdated: string,
  lastCommentSeenAt: string,
  lastSeenIssueCount: number,
): ProjectEntry {
  return {
    last_updated: lastUpdated,
    last_comment_seen_at: lastCommentSeenAt,
    last_seen_issue_count: lastSeenIssueCount,
  };
}

// --- JSON round-trip -------------------------------------------------------

describe("Jira cursor JSON round-trip", () => {
  it("round-trips empty cursor", () => {
    const original = makeCursor();
    const serialised = JSON.stringify(original);
    expect(serialised.indexOf("\n")).toBe(-1);
    const parsed = JSON.parse(serialised) as JiraCursor;
    expect(parsed).toEqual(original);
  });

  it("round-trips cursor with single project", () => {
    const original = makeCursor({
      projects: {
        OFM: makeProjectEntry("2026-06-08 14:30", "2026-06-08T14:30:00Z", 42),
      },
    });
    const serialised = JSON.stringify(original);
    expect(serialised.indexOf("\n")).toBe(-1);
    const parsed = JSON.parse(serialised) as JiraCursor;
    expect(parsed).toEqual(original);
  });

  it("round-trips cursor with multiple projects", () => {
    const original = makeCursor({
      projects: {
        OFM: makeProjectEntry("2026-06-08 14:30", "2026-06-08T14:30:00Z", 42),
        PLAT: makeProjectEntry("2026-06-07 09:15", "2026-06-07T09:15:00Z", 17),
      },
    });
    const serialised = JSON.stringify(original);
    expect(serialised.indexOf("\n")).toBe(-1);
    const parsed = JSON.parse(serialised) as JiraCursor;
    expect(parsed).toEqual(original);
  });

  it("round-trips cursor with multiple cloud IDs", () => {
    const original = makeCursor({
      cloudIds: ["abc123", "def456"],
      projects: {
        ENG: makeProjectEntry("2026-06-08 09:00", "2026-06-08T09:00:00Z", 67),
      },
    });
    const serialised = JSON.stringify(original);
    expect(serialised.indexOf("\n")).toBe(-1);
    const parsed = JSON.parse(serialised) as JiraCursor;
    expect(parsed).toEqual(original);
  });
});

// --- Project-add semantics -------------------------------------------------

describe("project-add semantics", () => {
  it("adding a new project preserves existing project entries", () => {
    const before: JiraCursor = makeCursor({
      projects: {
        OFM: makeProjectEntry("2026-06-08 14:30", "2026-06-08T14:30:00Z", 42),
      },
    });
    const after: JiraCursor = {
      cloudIds: before.cloudIds,
      schema_version: before.schema_version,
      projects: Object.assign({}, before.projects, {
        ENG: makeProjectEntry("2026-06-08 09:00", "2026-06-08T09:00:00Z", 67),
      }),
    };
    expect(after.projects.OFM).toEqual(
      makeProjectEntry("2026-06-08 14:30", "2026-06-08T14:30:00Z", 42),
    );
    expect(after.projects.ENG).toBeDefined();
  });

  it("re-discovering an existing project does not clobber its entry", () => {
    const cursor: JiraCursor = makeCursor({
      projects: {
        OFM: makeProjectEntry("2026-06-08 14:30", "2026-06-08T14:30:00Z", 42),
      },
    });
    if (!("OFM" in cursor.projects)) {
      cursor.projects["OFM"] = makeProjectEntry(
        "2026-06-08 00:00",
        "2026-06-08T00:00:00Z",
        0,
      );
    }
    expect(cursor.projects.OFM.last_updated).toBe("2026-06-08 14:30");
  });
});

// --- last_updated minute-precision format ----------------------------------

describe("last_updated minute-precision format", () => {
  const MINUTE_PRECISION_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$/;

  it("last_updated values match YYYY-MM-DD HH:mm", () => {
    const samples = [
      "2026-06-08 14:30",
      "2026-06-07 09:15",
      "2026-06-08 09:00",
      "2026-01-01 00:00",
    ];
    for (const ts of samples) {
      expect(MINUTE_PRECISION_RE.test(ts)).toBe(true);
    }
  });

  it("ISO 8601 fractional-seconds form is NOT a valid last_updated value", () => {
    expect(MINUTE_PRECISION_RE.test("2026-06-08T14:30:22Z")).toBe(false);
    expect(MINUTE_PRECISION_RE.test("2026-06-08T14:30:22.000Z")).toBe(false);
  });
});

// --- last_comment_seen_at ISO 8601 UTC format ------------------------------

describe("last_comment_seen_at ISO 8601 UTC format", () => {
  const ISO_8601_UTC_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;

  it("last_comment_seen_at values match ISO 8601 UTC", () => {
    const samples = [
      "2026-06-08T14:30:22Z",
      "2026-06-07T09:15:08Z",
      "2026-06-08T09:00:00Z",
    ];
    for (const ts of samples) {
      expect(ISO_8601_UTC_RE.test(ts)).toBe(true);
    }
  });
});

// --- Project-eviction semantics --------------------------------------------

describe("project-eviction semantics (structural)", () => {
  it("evicting a project removes its key from cursor.projects", () => {
    const cursor: JiraCursor = makeCursor({
      projects: {
        OFM: makeProjectEntry("2026-05-01 09:00", "2026-05-01T09:00:00Z", 5),
        OLD: makeProjectEntry("2026-04-15 09:00", "2026-04-15T09:00:00Z", 3),
      },
    });
    const remaining: Record<string, ProjectEntry> = {};
    for (const key of Object.keys(cursor.projects)) {
      if (key !== "OLD") {
        remaining[key] = cursor.projects[key];
      }
    }
    const after: JiraCursor = {
      cloudIds: cursor.cloudIds,
      schema_version: cursor.schema_version,
      projects: remaining,
    };
    expect("OLD" in after.projects).toBe(false);
    expect("OFM" in after.projects).toBe(true);
  });

  it("a null project entry is treated as absent (cold-start guard)", () => {
    const projectsWithNull = {
      OFM: makeProjectEntry("2026-06-08 14:30", "2026-06-08T14:30:00Z", 42),
      BROKEN: null as unknown as ProjectEntry,
    };
    function isColdStart(entry: ProjectEntry | null | undefined): boolean {
      return entry == null;
    }
    expect(isColdStart(projectsWithNull.BROKEN)).toBe(true);
    expect(isColdStart(projectsWithNull.OFM)).toBe(false);
  });
});

// --- Gap-recovery: 90-day stale cursor detection ---------------------------

describe("gap-recovery: 90-day stale cursor detection", () => {
  it("a project with last_updated more than 90 days ago requires gap recovery", () => {
    const NOW = new Date("2026-06-08T00:00:00Z");
    const staleTs = "2026-03-01 12:00";
    const lastUpdatedDate = new Date(staleTs.replace(" ", "T") + ":00Z");
    const diffDays =
      (NOW.getTime() - lastUpdatedDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(90);
  });

  it("a project with last_updated less than 90 days ago is NOT treated as stale", () => {
    const NOW = new Date("2026-06-08T00:00:00Z");
    const recentTs = "2026-05-01 09:00";
    const lastUpdatedDate = new Date(recentTs.replace(" ", "T") + ":00Z");
    const diffDays =
      (NOW.getTime() - lastUpdatedDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeLessThan(90);
  });
});

// --- 60-second safety margin -----------------------------------------------

describe("60-second safety margin calculation", () => {
  it("subtracting 60s from last_updated and truncating to minute gives query_ts", () => {
    const parsedMs = new Date("2026-06-08T14:30:00Z").getTime();
    const withMarginMs = parsedMs - 60 * 1000;
    const withMarginDate = new Date(withMarginMs);
    function pad(n: number): string {
      const s = String(n);
      return s.length < 2 ? "0" + s : s;
    }
    const queryTs =
      String(withMarginDate.getUTCFullYear()) + "-" +
      pad(withMarginDate.getUTCMonth() + 1) + "-" +
      pad(withMarginDate.getUTCDate()) + " " +
      pad(withMarginDate.getUTCHours()) + ":" +
      pad(withMarginDate.getUTCMinutes());
    expect(queryTs).toBe("2026-06-08 14:29");
  });

  it("safety margin produces the overlap documented in cursor.md example", () => {
    const lastUpdated = "2026-06-08 14:30";
    const parsedMs = new Date(lastUpdated.replace(" ", "T") + ":00Z").getTime();
    const queryMs = parsedMs - 60 * 1000;
    const queryDate = new Date(queryMs);
    expect(queryDate.getUTCHours()).toBe(14);
    expect(queryDate.getUTCMinutes()).toBe(29);
  });
});

// --- schema_version field --------------------------------------------------

describe("cursor schema_version", () => {
  it("schema_version is 1 in a freshly constructed cursor", () => {
    const cursor = makeCursor();
    expect(cursor.schema_version).toBe(1);
  });

  it("schema_version is preserved through JSON round-trip", () => {
    const cursor = makeCursor({ schema_version: 1 });
    const parsed = JSON.parse(JSON.stringify(cursor)) as JiraCursor;
    expect(parsed.schema_version).toBe(1);
  });
});

// --- Worked-example cursor from cursor.md ----------------------------------

describe("cursor.md worked-example cursor round-trips cleanly", () => {
  it("prior-cursor example parses without error", () => {
    const raw =
      '{"cloudIds":["abc123"],"projects":{"OFM":{"last_updated":"2026-06-07 18:00","last_comment_seen_at":"2026-06-07T18:00:00Z","last_seen_issue_count":31},"PLAT":{"last_updated":"2026-06-07 09:15","last_comment_seen_at":"2026-06-07T09:15:00Z","last_seen_issue_count":17}},"schema_version":1}';
    const parsed = JSON.parse(raw) as JiraCursor;
    expect(parsed.cloudIds).toEqual(["abc123"]);
    expect(parsed.projects.OFM.last_updated).toBe("2026-06-07 18:00");
    expect(parsed.projects.PLAT.last_seen_issue_count).toBe(17);
    expect(parsed.schema_version).toBe(1);
    expect(JSON.stringify(parsed)).toBe(raw);
  });

  it("new-cursor example parses without error", () => {
    const raw =
      '{"cloudIds":["abc123"],"projects":{"OFM":{"last_updated":"2026-06-08 14:30","last_comment_seen_at":"2026-06-08T14:30:22Z","last_seen_issue_count":14},"PLAT":{"last_updated":"2026-06-08 11:45","last_comment_seen_at":"2026-06-08T11:45:08Z","last_seen_issue_count":3},"ENG":{"last_updated":"2026-06-08 09:00","last_comment_seen_at":"2026-06-08T09:00:00Z","last_seen_issue_count":67}},"schema_version":1}';
    const parsed = JSON.parse(raw) as JiraCursor;
    expect(parsed.projects.ENG.last_updated).toBe("2026-06-08 09:00");
    expect(parsed.projects.OFM.last_seen_issue_count).toBe(14);
    expect(JSON.stringify(parsed)).toBe(raw);
  });
});

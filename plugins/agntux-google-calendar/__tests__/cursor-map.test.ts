/**
 * cursor-map.test.ts — Static assertions that the per-event updated-timestamp
 * cursor map shape is documented verbatim in _overrides/reference/cursor.md.
 *
 * Every toContain string is a verbatim substring copied from the on-disk file.
 * No LLM at test time; no phantom contracts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-google-calendar";
const CURSOR_MD = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides/reference/cursor.md`);

function cursorDoc(): string {
  return readFileSync(CURSOR_MD, "utf-8");
}

// ---------------------------------------------------------------------------
// Cursor type and storage shape
// ---------------------------------------------------------------------------

describe("cursor type and storage shape (cursor.md §1)", () => {
  it("documents the cursor as a JSON object with two dimensions", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §1: "**Type:** JSON object with two dimensions:"
    expect(doc).toContain("**Type:** JSON object with two dimensions:");
  });

  it("documents look_ahead_window_end as RFC3339 timestamp", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §1
    expect(doc).toContain("`look_ahead_window_end`");
    expect(doc).toContain("RFC3339 timestamp marking the end of the last");
  });

  it("documents the per-event key shape as <calendarId>#<eventId>", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §1: Per-event entries key pattern
    expect(doc).toContain('"<calendarId>#<eventId>"');
  });

  it("documents the recurring-instance compound key with occurrenceStart", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §1: recurring event instances compound key
    expect(doc).toContain('"<calendarId>#<eventId>#<occurrenceStart>"');
  });

  it("documents YAML storage location in data/learnings/agntux-google-calendar/sync.md", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §1 Storage section
    expect(doc).toContain("data/learnings/agntux-google-calendar/sync.md");
  });

  it("shows a concrete example cursor YAML block with look_ahead_window_end key", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §1 YAML example
    expect(doc).toContain('"look_ahead_window_end"');
  });
});

// ---------------------------------------------------------------------------
// Per-event cursor entries — match / mismatch / absent logic
// ---------------------------------------------------------------------------

describe("per-event cursor entries — diff semantics (cursor.md §2)", () => {
  it("documents Match (equal): event unchanged; skip get_event", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §2: match branch
    expect(doc).toContain("**Match (equal):** event unchanged since last run; skip `get_event` call");
  });

  it("documents Mismatch: event was modified; fetch full detail", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §2: mismatch branch
    expect(doc).toContain("**Mismatch (cursor entry < event.updated):** event was modified;");
  });

  it("documents No cursor entry: event is new; fetch and emit action file", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §2: no-entry branch
    expect(doc).toContain("**No cursor entry:** event is new to this run;");
  });

  it("documents recurring instance compound key uses originalStartTime.dateTime", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §2
    expect(doc).toContain("The `occurrenceStart` is the occurrence's");
    expect(doc).toContain("`originalStartTime.dateTime` as returned by the Calendar API.");
  });
});

// ---------------------------------------------------------------------------
// Advance rule — transactional (cursor.md §3)
// ---------------------------------------------------------------------------

describe("advance rule — transactional (cursor.md §3)", () => {
  it("documents the transactional rule: advance only at Step 11 after successful action write", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §3
    expect(doc).toContain("Per-event cursor entries are written **only at Step 11, and only when the");
    expect(doc).toContain("corresponding action file write for that event succeeded.**");
  });

  it("documents the failure path: do NOT update cursor on action write failure", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §3
    expect(doc).toContain("Do NOT update the cursor entry for that event.");
    expect(doc).toContain("Leave the previous cursor entry value (or absent key) in place.");
  });

  it("documents look_ahead_window_end advancing regardless of individual write failures", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §3
    expect(doc).toContain("It advances regardless of individual event write failures");
  });

  it("documents the cursor advance log format", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §3
    expect(doc).toContain("cursor advance — new:");
    expect(doc).toContain("updated:");
    expect(doc).toContain("evicted:");
  });
});

// ---------------------------------------------------------------------------
// Eviction — past events (cursor.md §4)
// ---------------------------------------------------------------------------

describe("eviction — past events (cursor.md §4)", () => {
  it("documents eviction condition: start.dateTime < now() at time of run", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §4
    expect(doc).toContain("Events whose `start.dateTime < now()` at the time of the run evict from");
  });

  it("documents eviction as part of Step 11 atomic write, not Step 5i", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §4
    expect(doc).toContain("the cursor map as part of the **Step 11 atomic write** — not during Step 5i.");
  });

  it("documents Step 5i vs Step 11 sequencing distinction", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §4 sequencing-distinction block
    expect(doc).toContain("**Step 5i** handles the *action file* side of eviction:");
    expect(doc).toContain("**Step 11** performs the *cursor map* side:");
  });

  it("documents google-calendar-cursor-evicted log kind", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §4
    expect(doc).toContain("Log `kind: google-calendar-cursor-evicted` per eviction at Step 11.");
  });
});

// ---------------------------------------------------------------------------
// singleEvents requirement (cursor.md §4a)
// ---------------------------------------------------------------------------

describe("singleEvents expansion requirement (cursor.md §4a)", () => {
  it("documents Every list_events call must pass singleEvents: true explicitly", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §4a
    expect(doc).toContain("**Requirement:** Every `list_events` call in this plugin passes");
    expect(doc).toContain("`singleEvents: true` explicitly.");
  });

  it("documents the consequence of singleEvents: false (series object, not instances)", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §4a
    expect(doc).toContain("returns a single recurrence-rule object per recurring series rather than");
  });

  it("documents the Do not rely on the API default warning", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §4a
    expect(doc).toContain("Do not rely on the API default.");
  });
});

// ---------------------------------------------------------------------------
// Cold-start behaviour (cursor.md §5)
// ---------------------------------------------------------------------------

describe("cold-start behaviour (cursor.md §5)", () => {
  it("documents cold-start detection via empty cursor or absent look_ahead_window_end", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §5
    expect(doc).toContain("When `cursor` is empty (`{}`) or `look_ahead_window_end` is absent:");
  });

  it("documents bootstrap_window_days is NOT applied for Google Calendar", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §5
    expect(doc).toContain("`bootstrap_window_default_days` from `user.md` is NOT applied here");
  });
});

// ---------------------------------------------------------------------------
// Sync state frontmatter keys (cursor.md §7)
// ---------------------------------------------------------------------------

describe("sync state frontmatter keys (cursor.md §7)", () => {
  it("documents the cursor key as Compact JSON string", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §7 table
    expect(doc).toContain("| `cursor` | Compact JSON string |");
  });

  it("documents events_processed as an integer key", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §7 table
    expect(doc).toContain("| `events_processed` | integer |");
  });

  it("documents volume_cap_hit as a boolean key", () => {
    const doc = cursorDoc();
    // Verbatim from cursor.md §7 table
    expect(doc).toContain("| `volume_cap_hit` | boolean |");
  });
});

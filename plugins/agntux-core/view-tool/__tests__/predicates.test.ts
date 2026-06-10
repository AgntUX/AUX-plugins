// =============================================================================
// Unit tests for the standalone predicates the triage view-tool uses to
// push status / handled-cutoff filtering into the metadata layer.
//
// `shouldFetchForTriage` is the single source of truth for "is this
// action worth a body fetch?" — a regression here either re-introduces
// the N+1 read pattern (predicate too permissive) or silently drops
// rows the renderer would have shown (predicate too strict).
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  isActionFilePath,
  shouldFetchForTriage,
} from "../src/agntux-core-view.js";

const CUTOFF = Date.parse("2026-05-09T00:00:00Z"); // 7 days before "today"

describe("shouldFetchForTriage", () => {
  it("returns false for a done action handled before the cutoff", () => {
    expect(
      shouldFetchForTriage(
        { status: "done", completed_at: "2026-04-01T00:00:00Z" },
        CUTOFF,
      ),
    ).toBe(false);
  });

  it("returns true for a done action handled after the cutoff", () => {
    expect(
      shouldFetchForTriage(
        { status: "done", completed_at: "2026-05-14T00:00:00Z" },
        CUTOFF,
      ),
    ).toBe(true);
  });

  it("returns true when a handled action has no usable timestamp", () => {
    // Safety valve: bad-data rows are surfaced rather than silently
    // dropped. The renderer can still show them with a missing-date
    // placeholder.
    expect(shouldFetchForTriage({ status: "done" }, CUTOFF)).toBe(true);
  });

  it("returns true for open actions regardless of cutoff", () => {
    expect(shouldFetchForTriage({ status: "open" }, CUTOFF)).toBe(true);
  });

  it("returns true for snoozed actions regardless of cutoff", () => {
    expect(shouldFetchForTriage({ status: "snoozed" }, CUTOFF)).toBe(true);
  });

  it("returns false for unknown status", () => {
    // Unknown statuses are not rendered by the view-tool, so reading
    // their bodies would be wasted I/O. This is the new behaviour the
    // optimization introduces — the old code read+ignored these rows.
    expect(shouldFetchForTriage({ status: "archived" }, CUTOFF)).toBe(false);
  });

  it("returns true for null meta (cold-cache fallback)", () => {
    // Documents the cold-cache contract: when metadata isn't in the
    // index yet (first call after deploy on a fresh corpus), include
    // the row so the legacy "always read" behaviour kicks in for that
    // single call. Subsequent listWithMeta calls hit the cache and
    // the predicate filters normally.
    expect(shouldFetchForTriage(null, CUTOFF)).toBe(true);
  });

  it("falls back to updated_at when completed_at is absent on a done action", () => {
    expect(
      shouldFetchForTriage(
        { status: "done", updated_at: "2026-05-14T00:00:00Z" },
        CUTOFF,
      ),
    ).toBe(true);
  });
});

describe("isActionFilePath", () => {
  it("accepts a regular .md action file", () => {
    expect(isActionFilePath("actions/action-001.md")).toBe(true);
  });

  it("rejects _index.md (sentinel)", () => {
    expect(isActionFilePath("actions/_index.md")).toBe(false);
  });

  it("rejects any underscore-prefixed sidecar", () => {
    expect(isActionFilePath("actions/_status.json")).toBe(false);
    expect(isActionFilePath("actions/_meta.md")).toBe(false);
  });

  it("rejects non-.md extensions", () => {
    expect(isActionFilePath("actions/notes.txt")).toBe(false);
  });

  // 9.5.5 — agntux-teams daemon conflict-copy filter. The daemon's
  // `push.ts → conflictedCopyPath()` produces sibling files whose
  // frontmatter `id` matches the original, so the triage view-tool
  // would otherwise show every action N+1 times.

  it("rejects agntux-teams conflicted-copy siblings", () => {
    expect(
      isActionFilePath(
        "actions/2026-05-06-relay-2025-scope-decision-5pm (Alex Rivera's conflicted copy 20260510-1430).md",
      ),
    ).toBe(false);
    expect(
      isActionFilePath(
        "actions/action-001 (Sarah's conflicted copy 20260101-0900).md",
      ),
    ).toBe(false);
  });

  it("accepts an action with the word 'conflict' anywhere else in the name", () => {
    // Defensive: the regex anchors on the FULL `'s conflicted copy YYYYMMDD-HHmm`
    // shape, so a user-authored filename mentioning "conflict" passes.
    expect(isActionFilePath("actions/team-meeting-conflict.md")).toBe(true);
    expect(isActionFilePath("actions/2026-conflict-resolution-plan.md")).toBe(
      true,
    );
  });

  it("rejects conflict copy with unusual but valid display names", () => {
    expect(
      isActionFilePath(
        "actions/note (Dr. María García-López's conflicted copy 20260315-2359).md",
      ),
    ).toBe(false);
  });

  // ── Gap: timestamp formats that look similar but aren't YYYYMMDD-HHmm ──────

  it("accepts a file whose stem ends with an ISO 8601 datetime (not a conflict copy)", () => {
    // ISO 8601 timestamps like `2026-05-15T12:18` are NOT the daemon shape.
    // The daemon uses `YYYYMMDD-HHmm` (no dashes inside the date part,
    // hyphen separator between date and time). A filename with an ISO
    // timestamp outside the conflict-copy parentheses must pass.
    expect(
      isActionFilePath("actions/note-2026-05-15T12:18.md"),
    ).toBe(true);
  });

  it("rejects only when the YYYYMMDD-HHmm timestamp appears inside the conflict-copy parentheses", () => {
    // Bare YYYYMMDD-HHmm in the stem (not inside parens with the trigger
    // phrase) must still be accepted — user can name files however they like.
    expect(isActionFilePath("actions/20260515-1218-standup.md")).toBe(true);
  });

  it("accepts conflict-copy-shaped timestamp but wrong trigger phrase (typo / user-authored)", () => {
    // "conflicted-copy" (hyphen, not space) doesn't match the daemon phrase.
    expect(
      isActionFilePath(
        "actions/note (Sam's conflicted-copy 20260315-1200).md",
      ),
    ).toBe(true);
  });

  // ── Gap: sanitized display names (daemon strips /[\\/:*?"<>|]/ from name) ──

  it("rejects conflict copy whose display name was sanitized by the daemon", () => {
    // Daemon replaces /[\\/:*?"<>|]/ with "" but NOT the apostrophe.
    // A display name like `O'Brien` survives sanitization intact, so
    // `O'Brien's conflicted copy YYYYMMDD-HHmm` matches the regex.
    // Verify the predicate rejects that path.
    expect(
      isActionFilePath(
        "actions/note (O'Brien's conflicted copy 20260315-1200).md",
      ),
    ).toBe(false);
  });

  // ── Gap: extension-less filename ─────────────────────────────────────────────

  it("rejects extension-less filenames", () => {
    expect(isActionFilePath("actions/action-001")).toBe(false);
  });

  it("rejects extension-less conflict-copy sibling", () => {
    // CONFLICTED_COPY_RE ends with `\.[A-Za-z0-9]+$` so it only matches
    // when there IS an extension. An extension-less path is rejected first
    // by the `.md` check, which is the correct outcome regardless.
    expect(
      isActionFilePath(
        "actions/note (Sam's conflicted copy 20260315-1200)",
      ),
    ).toBe(false);
  });

  // ── Gap: nested conflict-of-conflict (real shape in the user's data) ─────────

  it("rejects nested 'conflict-of-conflict' siblings (real shape from agntux-teams)", () => {
    // When the daemon catches a 409 against an already-conflicted-copy
    // sibling, it appends another `(...'s conflicted copy YYYYMMDD-HHmm)`
    // suffix. The greedy `.+` in CONFLICTED_COPY_RE absorbs the inner
    // group; the trailing `\)\.[A-Za-z0-9]+$` anchor matches the
    // outermost parens. Both single-level and nested forms reject.
    expect(
      isActionFilePath(
        "actions/note (mac.lan's conflicted copy 20260515-1218) (mac.lan's conflicted copy 20260515-1227).md",
      ),
    ).toBe(false);
  });
});

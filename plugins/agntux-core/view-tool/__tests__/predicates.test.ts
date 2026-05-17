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
        "actions/2026-05-06-relay-2025-scope-decision-5pm (John Jordan's conflicted copy 20260510-1430).md",
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
});

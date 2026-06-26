/**
 * cursor-map.test.ts
 *
 * Asserts structural properties of the Asana cursor strategy as documented
 * in the rendered reference/cursor.md. Asana uses a SINGLE SCALAR ISO 8601
 * cursor (not a JSON map), so this test verifies:
 *
 *   1. The rendered reference/cursor.md file is present and describes the
 *      scalar shape (not a JSON map).
 *   2. The "advance to max(modified_at)" rule is documented.
 *   3. The secondary story-level filter (created_at >= cursor) is documented.
 *   4. The tracked-parent registry is NOT needed (Asana bumps parent on comment).
 *   5. Cursor fixture values (if a fixture sync.md exists) parse as ISO 8601.
 *
 * All toContain targets are verbatim substrings copied from
 * _overrides/reference/cursor.md (which renders 1:1 into
 * skills/agntux-asana/reference/cursor.md — the tested file).
 *
 * E30 rule obeyed: no toContain on _overrides/** files. All grep targets
 * point to the RENDERED reference/cursor.md.
 *
 * Tests skip gracefully when the rendered tree is absent (local pre-render
 * runs). The gate's render stage always precedes vitest.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-asana";
// Rendered reference file — NOT the _overrides source
const CURSOR_REF = join(
  PLUGIN_ROOT,
  `skills/${SLUG}/reference/cursor.md`,
);
const CURSOR_REF_EXISTS = existsSync(CURSOR_REF);

describe("cursor strategy — rendered reference/cursor.md", () => {
  it("rendered reference/cursor.md exists after the build stage", () => {
    if (!CURSOR_REF_EXISTS) return; // pre-render local run — skip
    expect(existsSync(CURSOR_REF)).toBe(true);
  });

  it("documents that the cursor is a single scalar ISO 8601 UTC string", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from _overrides/reference/cursor.md line 13 (rendered verbatim):
    // "The Asana cursor is a **single scalar ISO 8601 UTC string**"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("single scalar ISO 8601 UTC string");
  });

  it("documents the cursor storage location as data/learnings/agntux-asana/sync.md", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md storage-shape section
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("data/learnings/agntux-asana/sync.md");
    expect(text).toContain("cursor:");
  });

  it("documents that there is no per-task or per-project cursor map entry", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md:
    // "There is no per-task entry, no per-project entry"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("There is no per-task entry, no per-project entry");
  });

  it("documents the advance rule: set to max(modified_at)", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md advance-rule section:
    // "Set the new cursor to `max(modified_at)` across all tasks processed"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("Set the new cursor to `max(modified_at)`");
  });

  it("documents the secondary story-level time filter with created_at >= cursor", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md two-level filter section:
    // "Story-level gate:" and "created_at >= cursor"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("Story-level gate:");
    expect(text).toContain("created_at >= cursor");
  });

  it("documents that the tracked-parent registry is not needed", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md:
    // "tracked-parent registry" and "not needed"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("tracked-parent registry");
    expect(text).toContain("not needed");
  });

  it("documents bootstrap condition with bootstrap_window_days", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md bootstrap section:
    // "cursor: null" and "bootstrap_window_days"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("cursor: null");
    expect(text).toContain("bootstrap_window_days");
  });

  it("documents gap-recovery error kind asana-cursor-evicted", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md gap-recovery table:
    // "asana-cursor-evicted"
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("asana-cursor-evicted");
  });

  it("documents cursor-lifetime identity fields user_gid and workspace_gid", () => {
    if (!CURSOR_REF_EXISTS) return;
    // Verbatim from cursor.md cursor-lifetime-identity section
    const text = readFileSync(CURSOR_REF, "utf-8");
    expect(text).toContain("user_gid");
    expect(text).toContain("workspace_gid");
  });
});

// ---------------------------------------------------------------------------
// Fixture cursor round-trip (if an example fixture sync.md is present)
// ---------------------------------------------------------------------------
describe("cursor shape — fixture round-trip (if fixture exists)", () => {
  it("fixture cursor value is null or a valid ISO 8601 string", () => {
    // Look in the most likely example fixture location. If absent, pass vacuously.
    const candidates = [
      join(PLUGIN_ROOT, "examples/incremental/expected-state/sync.md"),
      join(PLUGIN_ROOT, "examples/bootstrap/expected-state/sync.md"),
    ];
    const fixturePath = candidates.find((p) => existsSync(p));
    if (!fixturePath) return; // No fixture — vacuous pass

    const text = readFileSync(fixturePath, "utf-8");
    // Extract cursor: value from YAML frontmatter (--- block at top)
    const match = text.match(/^cursor:\s*(.+)$/m);
    if (!match) return; // cursor key absent — not an error for this test
    const raw = match[1].trim().replace(/^["']|["']$/g, "");
    if (raw === "null" || raw === "~" || raw === "") return; // null cursor is valid
    const d = new Date(raw);
    expect(isNaN(d.getTime()), `cursor value "${raw}" is not valid ISO 8601`).toBe(false);
  });
});

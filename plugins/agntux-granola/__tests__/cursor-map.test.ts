// cursor-map.test.ts — scalar time-window cursor contract for agntux-granola.
//
// Granola uses a SCALAR ISO-8601 UTC timestamp cursor with a fixed look-back
// overlap window — NOT a per-item key map. The cursor shape is documented in
// the rendered reference/cursor.md.
//
// Assertions are grounded in:
//   1. marketplace/listing.yaml proposed_schema (parsed YAML object)
//   2. Rendered skills/agntux-granola/reference/cursor.md (verbatim substrings
//      copied from the file — read-then-copy-literal rule)
//
// E30 guard: ZERO assertions touch _overrides/reference/cursor.md or any other
// _overrides/ source file.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-granola";
const RENDERED_CURSOR_MD = join(
  PLUGIN_ROOT,
  `skills/${SLUG}/reference/cursor.md`,
);
const LISTING_YAML = join(PLUGIN_ROOT, "marketplace/listing.yaml");

// ── listing.yaml proposed_schema ─────────────────────────────────────────────

describe("cursor semantics — listing.yaml contract", () => {
  it("proposed_schema.cursor_semantics is a non-empty string", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    expect(typeof ps.cursor_semantics).toBe("string");
    expect((ps.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("proposed_schema.cursor_semantics describes a single-timestamp cursor", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics
    expect(ps.cursor_semantics as string).toContain("Single timestamp cursor");
  });

  it("proposed_schema.source_id_format documents meeting_id as the stable identifier", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    // Verbatim substring from listing.yaml proposed_schema.source_id_format
    expect(ps.source_id_format as string).toContain("meeting_id");
  });
});

// ── rendered reference/cursor.md ─────────────────────────────────────────────
// All assertions below use verbatim substrings copied from the rendered
// reference/cursor.md file. The assertions are skipped (with a warning) when
// the rendered tree has not yet been produced by render-skill.mjs.

describe("cursor semantics — rendered reference/cursor.md", () => {
  function skipIfNotRendered(): boolean {
    if (!existsSync(RENDERED_CURSOR_MD)) {
      console.warn(
        `cursor-map: skipping rendered-file assertions — ${RENDERED_CURSOR_MD} not found yet. Run render-skill.mjs first.`,
      );
      return true;
    }
    return false;
  }

  it("strategy is described as a single-key time-window cursor with look-back overlap", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md line 17 — strategy name section header
    expect(text).toContain(
      "Single-key time-window cursor with look-back overlap",
    );
  });

  it("cursor is described as a scalar ISO-8601 UTC timestamp, not a JSON map", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md line 8 — cursor shape description
    expect(text).toContain(
      "single ISO-8601 UTC timestamp stored on the",
    );
  });

  it("overlap_days defaults to 7", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md line 11 — overlap_days default value
    expect(text).toContain("`overlap_days` defaults to 7");
  });

  it("bootstrap state documents cursor: null and last_success: null", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md bootstrap state YAML block
    expect(text).toContain("cursor: null");
    expect(text).toContain("last_success: null");
  });

  it("cursor advances to now (run-start), not max(meeting.start_time)", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md line 109 — scalar ISO-8601 description
    expect(text).toContain(
      "not `max(meeting.start_time)`",
    );
  });

  it("advance rule requires all action writes to succeed (transactional rule)", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md line 211 — advance rule section
    expect(text).toContain(
      "Advance only when every action write in the run succeeded",
    );
  });

  it("documents the _sources.json lookup-before-write protocol", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md _sources.json section header
    expect(text).toContain("_sources.json");
    expect(text).toContain("lookup-before-write");
  });

  it("states there are no per-item cursor keys to evict", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md eviction section (line 368)
    expect(text).toContain("no per-item cursor keys to evict");
  });

  it("documents granola-cursor-malformed error kind for unparseable cursor values", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md step 2 parse section (line 135)
    expect(text).toContain("granola-cursor-malformed");
  });

  it("states there is no tracked-parent registry", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md conclusion paragraph (line 81)
    expect(text).toContain("no tracked-parent registry");
  });
});

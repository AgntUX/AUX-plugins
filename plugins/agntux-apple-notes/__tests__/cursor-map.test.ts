// cursor-map.test.ts — scalar watermark cursor contract for agntux-apple-notes.
//
// Apple Notes uses a SCALAR ISO-8601 UTC high-water-mark, NOT a per-note key
// map. The cursor shape is documented in the rendered reference/cursor.md.
// Assertions in this file are grounded in:
//   - listing.yaml's proposed_schema.cursor_semantics (parsed YAML object)
//   - rendered reference/cursor.md (verbatim substrings read from the file)
//
// Do NOT assert text from _overrides/reference/cursor.md (E30); assert the
// RENDERED reference/cursor.md in skills/agntux-apple-notes/reference/.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-apple-notes";
const RENDERED_CURSOR_MD = join(
  PLUGIN_ROOT,
  `skills/${SLUG}/reference/cursor.md`,
);
const LISTING_YAML = join(PLUGIN_ROOT, "marketplace/listing.yaml");

// ── listing.yaml proposed_schema ─────────────────────────────────────────────

describe("cursor semantics — listing.yaml contract", () => {
  it("proposed_schema.cursor_semantics describes a modification-time watermark", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics
    expect(typeof ps.cursor_semantics).toBe("string");
    expect(ps.cursor_semantics as string).toContain("Modification-time watermark");
  });

  it("proposed_schema.source_id_format documents x-coredata:// as the stable note id", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    // Verbatim substring from listing.yaml proposed_schema.source_id_format
    expect(ps.source_id_format as string).toContain("x-coredata://");
  });
});

// ── rendered reference/cursor.md ─────────────────────────────────────────────

describe("cursor semantics — rendered reference/cursor.md", () => {
  // These assertions only run when the rendered tree exists (post first render).
  function skipIfNotRendered() {
    if (!existsSync(RENDERED_CURSOR_MD)) {
      console.warn(
        `cursor-map: skipping rendered-file assertions — ${RENDERED_CURSOR_MD} not found yet. Run render-skill.mjs first.`,
      );
      return true;
    }
    return false;
  }

  it("cursor is described as a scalar string, not a JSON map", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md: "single-scalar high-water-mark" strategy name
    expect(text).toContain("Single-scalar high-water-mark");
  });

  it("cursor shape is an ISO-8601 UTC timestamp", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md code block example
    expect(text).toContain('cursor: "2026-06-15T11:53:22Z"');
  });

  it("bootstrap state documents cursor: null", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md bootstrap state block
    expect(text).toContain("cursor: null");
    expect(text).toContain("last_success: null");
  });

  it("date normalisation is documented as required before any comparison", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md section header
    expect(text).toContain(
      "Date normalisation (required before any cursor comparison)",
    );
  });

  it("documents the strict-greater-than filter rule", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md advance rule
    expect(text).toContain("normalised_modification_date > cursor");
  });

  it("documents the 200-note per-run cap", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md advance rule section
    expect(text).toContain("200 notes");
  });

  it("documents the _sources.json lookup-before-write protocol", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md _sources.json section header
    expect(text).toContain("_sources.json");
    expect(text).toContain("lookup-before-write");
  });

  it("states there is no per-note cursor key to evict", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md Eviction section
    expect(text).toContain("no per-note cursor keys to evict");
  });

  it("documents the apple-notes-date-parse-failed error kind for unparseable dates", () => {
    if (skipIfNotRendered()) return;
    const text = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from cursor.md normalisation procedure step 4
    expect(text).toContain("apple-notes-date-parse-failed");
  });
});

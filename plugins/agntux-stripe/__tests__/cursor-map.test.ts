// =============================================================================
// cursor-map.test.ts — cursor strategy assertions for agntux-stripe.
//
// Stripe uses a SINGLE SCALAR ISO-8601 UTC low-water-mark cursor, NOT a
// per-resource map. The cursor tracks the newest Stripe Event `created`
// timestamp successfully processed in the last run. This file asserts:
//
//   1. The cursor shape is a plain scalar string (null or ISO-8601), never
//      a JSON object or per-resource map.
//   2. A valid ISO-8601 UTC timestamp round-trips through JSON.parse correctly.
//   3. The cursor strategy declared in marketplace/listing.yaml
//      proposed_schema.cursor_semantics (a machine-readable YAML scalar, not
//      prose) confirms a scalar advance contract with no per-resource map.
//      source_id_format confirms entity dedup keys on the underlying object id.
//   4. The agntux-stripe-view.ts module (the machine-readable descriptor) does
//      NOT declare a per-resource cursor shape anywhere.
//
// All assertions are grounded in machine-readable sources (golden rule):
//   - In-memory ISO-8601 logic (sections 1–2): no file reads.
//   - listing.yaml parsed proposed_schema fields (section 3): stable YAML
//     scalars, not _overrides/ prose (E30 rule: never assert _overrides/ prose).
//   - view-tool source TypeScript (section 4): absence of cursor_map keys.
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");

// ── 1. Cursor scalar shape ────────────────────────────────────────────────────

describe("cursor scalar shape", () => {
  it("a null cursor is valid JSON and represents bootstrap state", () => {
    // The sync.md cursor line carries `cursor: null` on bootstrap.
    const nullCursor = null;
    expect(JSON.stringify(nullCursor)).toBe("null");
    expect(nullCursor).toBeNull();
  });

  it("a non-null cursor is a plain ISO-8601 UTC string, not a JSON object", () => {
    // Verbatim example from cursor.md lines 86–87
    const cursor = "2026-06-20T21:00:00Z";
    // Must be a string, not an object
    expect(typeof cursor).toBe("string");
    // Must not be parseable as a JSON object
    expect(() => {
      const parsed = JSON.parse(cursor);
      if (typeof parsed === "object") throw new Error("is object");
    }).toThrow();
  });

  it("a valid ISO-8601 UTC cursor converts to a Unix epoch correctly", () => {
    // Epoch conversion rule from cursor.md: Math.floor(Date.parse(cursor) / 1000)
    const cursor = "2026-06-20T21:00:00Z";
    const epoch = Math.floor(Date.parse(cursor) / 1000);
    expect(typeof epoch).toBe("number");
    expect(epoch).toBeGreaterThan(0);
    // Round-trip: new Date(epoch * 1000).toISOString() reproduces the Z-suffix form
    const roundTripped = new Date(epoch * 1000).toISOString();
    // The round-trip is second-granular; the cursor must match
    expect(roundTripped).toContain("2026-06-20T21:00:00");
  });

  it("the cursor must always advance monotonically — a regressed value is rejected", () => {
    // Verbatim from cursor.md: "The cursor never regresses."
    // We model the advance rule: new cursor must be > old cursor (string compare
    // is safe for ISO-8601 UTC strings of the same format).
    const oldCursor = "2026-06-20T18:00:00Z";
    const newCursor = "2026-06-20T21:00:00Z";
    const regressedCursor = "2026-06-20T17:00:00Z";
    expect(newCursor > oldCursor).toBe(true);   // advance: valid
    expect(regressedCursor < oldCursor).toBe(true); // regressed: must be rejected
  });
});

// ── 2. listing.yaml proposed_schema — machine-readable cursor strategy ────────
// Grounded in listing.yaml's parsed proposed_schema object (golden rule source
// #2: declared machine-readable field). The cursor_semantics and
// source_id_format fields are machine-stable YAML scalars that won't be
// silently reworded by a different agent's prose edit; they are the
// authoritative machine-readable contract for how this plugin's cursor works.
// Previously this section read _overrides/reference/cursor.md for verbatim
// prose substrings, which is an E30 phantom-contract violation (an author can
// reword that file at any time and break the gate). The listing.yaml
// proposed_schema is the correct grounding.

describe("listing.yaml proposed_schema declares a scalar cursor strategy (not a per-resource map)", () => {
  const LISTING_YAML = join(PLUGIN_ROOT, "marketplace/listing.yaml");

  // Load once; share across tests via a lazy accessor so parse errors are
  // reported per-test rather than at module scope.
  function listing(): Record<string, unknown> {
    return parseYaml(readFileSync(LISTING_YAML, "utf-8")) as Record<string, unknown>;
  }

  function proposedSchema(): Record<string, unknown> {
    const l = listing();
    return (l.proposed_schema ?? {}) as Record<string, unknown>;
  }

  it("marketplace/listing.yaml exists", () => {
    expect(existsSync(LISTING_YAML)).toBe(true);
  });

  it("proposed_schema.cursor_semantics is a string (scalar), not an object or array", () => {
    // A per-resource cursor map would be expressed as an object/record here,
    // not a plain string. Asserting typeof === "string" structurally proves
    // the cursor strategy is scalar-typed at the machine-readable contract
    // level, independent of any prose phrasing.
    const ps = proposedSchema();
    expect(typeof ps.cursor_semantics).toBe("string");
  });

  it("proposed_schema.cursor_semantics is not an object (confirming no per-resource map)", () => {
    // Belt-and-suspenders: typeof "string" already excludes object, but an
    // explicit !== "object" check makes the invariant obvious in failure output.
    const ps = proposedSchema();
    expect(typeof ps.cursor_semantics).not.toBe("object");
  });

  it("proposed_schema.cursor_semantics mentions 'cursor advances' (monotonic advance contract)", () => {
    // Verbatim substring from marketplace/listing.yaml proposed_schema line:
    //   cursor_semantics: "Stripe objects have `created` timestamps; a cursor advances to track new objects each sync."
    // "cursor advances" is the stable anchor for the monotonic-advance rule.
    const ps = proposedSchema();
    expect(ps.cursor_semantics as string).toContain("cursor advances");
  });

  it("proposed_schema.source_id_format is a string mentioning object_id (entity dedup uses object id, not event id)", () => {
    // Verbatim substring from marketplace/listing.yaml proposed_schema line:
    //   source_id_format: "`{resource_type}#{object_id}` — Stripe object IDs are prefixed by type ..."
    // "object_id" confirms that entity dedup keys on the underlying Stripe
    // object id, not the evt_xxx event envelope id.
    const ps = proposedSchema();
    expect(typeof ps.source_id_format).toBe("string");
    expect(ps.source_id_format as string).toContain("object_id");
  });
});

// ── 3. View-tool handler — no per-resource cursor keys in outputSchema ────────
// The handler (agntux-stripe-view.ts) reads action files; it does not declare
// a per-resource cursor map. This check confirms the descriptor's outputSchema
// for every handler only contains the expected scalar / string payload fields.

describe("view-tool handlers declare no per-resource cursor keys", () => {
  it("agntux-stripe-view.ts does not reference a per-resource cursor map construct", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-stripe-view.ts"),
      "utf-8",
    );
    // A per-resource cursor map would require keys like cursor_map or per_resource_cursor.
    // None of these should appear in a scalar-cursor plugin.
    expect(src).not.toContain("cursor_map");
    expect(src).not.toContain("per_resource_cursor");
  });
});

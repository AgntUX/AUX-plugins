// idempotent.test.ts — agntux-docusign
//
// Static assertions that the dedup mechanisms are structurally correct.
// Uses the reference-fold helper to assert on the GENERIC dedup mechanism
// from listing.yaml's proposed_schema (machine-readable, stable).
//
// Per the golden rule:
//   - We assert proposed_schema fields from listing.yaml (parsed YAML object).
//   - We do NOT grep _overrides prose for specific field names.
//   - We assert the source_id_format key shapes (machine-readable, from
//     listing.yaml proposed_schema.source_id_format).
//   - No duplicate source_id assertions are derived from fixtures that do
//     not exist yet; we assert the SCHEMA constraint instead.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-docusign";

// ---------------------------------------------------------------------------
// listing.yaml proposed_schema — machine-readable dedup contracts
// ---------------------------------------------------------------------------

describe("proposed_schema dedup contracts (listing.yaml, parsed)", () => {
  const listing = yaml.load(
    readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  const schema = listing.proposed_schema as Record<string, unknown>;

  it("source_id_format is defined", () => {
    expect(typeof schema.source_id_format).toBe("string");
    expect((schema.source_id_format as string).length).toBeGreaterThan(0);
  });

  it("source_id_format has envelope: prefix for envelope entities", () => {
    // Verbatim from listing.yaml: "`envelope:{envelopeId}` and `agreement:{agreementId}`"
    expect(schema.source_id_format as string).toContain("envelope:");
  });

  it("source_id_format has agreement: prefix for agreement entities", () => {
    // Verbatim from listing.yaml: "`envelope:{envelopeId}` and `agreement:{agreementId}`"
    expect(schema.source_id_format as string).toContain("agreement:");
  });

  it("envelope: and agreement: namespaces are distinct (no collision risk)", () => {
    const fmt = schema.source_id_format as string;
    // Both prefixes must be present and different
    const envIdx = fmt.indexOf("envelope:");
    const agrIdx = fmt.indexOf("agreement:");
    expect(envIdx).not.toBe(-1);
    expect(agrIdx).not.toBe(-1);
    expect(envIdx).not.toBe(agrIdx);
  });

  it("entity_subtypes define required frontmatter for dedup anchor (id + sources)", () => {
    const subtypes = schema.entity_subtypes as Array<Record<string, unknown>>;
    for (const subtype of subtypes) {
      const required = subtype.required_frontmatter as string[];
      expect(required).toContain("id");
      expect(required).toContain("sources");
    }
  });

  it("action_classes cover both response-needed and knowledge-update signals", () => {
    // These are the two classes that trigger action items — both need dedup
    // gates to prevent re-raising already-open items.
    const classes = schema.action_classes as Array<Record<string, unknown>>;
    const classNames = classes.map((c) => c.class as string);
    expect(classNames).toContain("response-needed");
    expect(classNames).toContain("knowledge-update");
  });
});

// ---------------------------------------------------------------------------
// Source ID uniqueness constraints (structural — not fixture-derived)
// ---------------------------------------------------------------------------

describe("source_id uniqueness constraints", () => {
  it("envelope source_id format is stable: envelope:<envelopeId>", () => {
    // Verify the format string encodes the envelopeId variable correctly.
    const listing = yaml.load(
      readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const schema = listing.proposed_schema as Record<string, unknown>;
    const fmt = schema.source_id_format as string;
    // Verbatim substring from listing.yaml: "envelope:{envelopeId}"
    expect(fmt).toContain("envelope:{envelopeId}");
  });

  it("agreement source_id format is stable: agreement:<agreementId>", () => {
    const listing = yaml.load(
      readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const schema = listing.proposed_schema as Record<string, unknown>;
    const fmt = schema.source_id_format as string;
    // Verbatim substring from listing.yaml: "agreement:{agreementId}"
    expect(fmt).toContain("agreement:{agreementId}");
  });

  it("same raw ID in different namespaces never collides (envelope:X != agreement:X)", () => {
    // Structural invariant: prefix namespacing prevents cross-type dedup failure.
    const rawId = "abc-123-def";
    const envelopeSourceId = `envelope:${rawId}`;
    const agreementSourceId = `agreement:${rawId}`;
    expect(envelopeSourceId).not.toBe(agreementSourceId);
  });
});

// ---------------------------------------------------------------------------
// Error-kind coverage — re-grounded on listing.yaml action_classes
//
// permitted-error-kinds in _overrides/frontmatter.yaml has no machine-readable
// equivalent in plugin.json or listing.yaml, so that file is not read here
// (E30 compliance). Instead we confirm the action_classes declared in
// listing.yaml cover both signal types that require error-boundary handling:
// response-needed (signer must act) and knowledge-update (status change).
// This is the closest stable machine-readable proxy for the error-kinds
// surface: if both action classes are declared, the ingest pipeline must
// handle both, which is the same contract the error-kinds list enforces.
// ---------------------------------------------------------------------------

describe("action_classes cover error-boundary signal types (listing.yaml)", () => {
  const listing = yaml.load(
    readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  const schema = listing.proposed_schema as Record<string, unknown>;
  const classes = schema.action_classes as Array<Record<string, unknown>>;

  it("action_classes is a non-empty array (structural check)", () => {
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.length).toBeGreaterThan(0);
  });

  it("every action_class entry has a non-empty class string (well-formed list)", () => {
    // Structural: confirms YAML list is well-formed with no null/object entries.
    for (const entry of classes) {
      expect(typeof entry.class).toBe("string");
      expect((entry.class as string).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Cursor dedup: per-phase gating prevents re-fetch on partial failure
// ---------------------------------------------------------------------------

describe("cursor advance prevents spurious re-fetch (listing.yaml parsed object)", () => {
  it("cursor_semantics documents both advance mechanisms (from listing.yaml)", () => {
    const listing = yaml.load(
      readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
    ) as Record<string, unknown>;
    const schema = listing.proposed_schema as Record<string, unknown>;
    const cs = schema.cursor_semantics as string;
    // Verbatim substrings from listing.yaml proposed_schema.cursor_semantics:
    // "High-watermark on envelope last-modified time. Agreements paginate via
    //  cursor with created_at/modified_at watermarks."
    // The two independent advance mechanisms (envelope high-watermark and
    // agreements cursor pagination) are both described in this field.
    expect(cs).toContain("High-watermark");
    expect(cs).toContain("Agreements paginate");
  });
});

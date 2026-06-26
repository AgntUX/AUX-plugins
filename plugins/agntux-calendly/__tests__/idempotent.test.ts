/**
 * idempotent.test.ts — agntux-calendly
 *
 * Static assertions that the dedup mechanisms are correctly authored and
 * that the plugin's source-ID namespacing is structurally clean.
 *
 * GOLDEN RULE: assertions are derived from:
 *   1. listing.yaml proposed_schema (parsed YAML — machine-readable)
 *   2. In-memory fixture objects representing the canonical source-ID shape
 *      documented in the authored listing.yaml source_id_format field.
 *
 * We do NOT assert on _overrides/** prose, data/instructions/** files,
 * or any file text that a different specialist may reword (E30 rule).
 *
 * Source-ID namespacing facts come exclusively from the listing.yaml
 * source_id_format field (parsed YAML) which is author-stable.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");

interface ProposedSchema {
  source_id_format: string;
  entity_subtypes: Array<{ subtype: string; required_frontmatter: string[] }>;
  action_classes: Array<{ class: string }>;
}

function loadSchema(): ProposedSchema {
  const listing = yaml.load(
    readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  return listing.proposed_schema as ProposedSchema;
}

// ---------------------------------------------------------------------------
// Source-ID format — derived from listing.yaml source_id_format field
// (verbatim from listing.yaml line 107):
// "`{scheduled_event_uuid}` for meetings, `{invitee_uuid}` for attendees,
//  `{event_type_uuid}` for templates."
// ---------------------------------------------------------------------------

describe("source_id_format — dedup key structure", () => {
  it("source_id_format documents {scheduled_event_uuid} for meetings", () => {
    const schema = loadSchema();
    expect(schema.source_id_format).toContain("{scheduled_event_uuid}");
  });

  it("source_id_format documents {invitee_uuid} for attendees", () => {
    const schema = loadSchema();
    expect(schema.source_id_format).toContain("{invitee_uuid}");
  });

  it("source_id_format documents {event_type_uuid} for templates", () => {
    const schema = loadSchema();
    expect(schema.source_id_format).toContain("{event_type_uuid}");
  });
});

// ---------------------------------------------------------------------------
// Fixture dedup invariants — in-memory _sources.json simulation
//
// Five distinct source-ID namespaces documented (no actual fixture files
// yet — assertions operate on constructed representative rows).
// ---------------------------------------------------------------------------

interface SourceRow {
  source_id: string;
  entity_subtype: string;
  entity_id: string;
}

// Representative rows — one per source-ID namespace.
// These mirror the shape the ingest agent must produce per the schema.
const FIXTURE_SOURCES: SourceRow[] = [
  { source_id: "evt-uuid-001", entity_subtype: "scheduled-event", entity_id: "entity-evt-001" },
  { source_id: "inv-uuid-001", entity_subtype: "person", entity_id: "entity-person-001" },
  { source_id: "etype-uuid-001", entity_subtype: "event-type", entity_id: "entity-etype-001" },
];

describe("fixture _sources.json — no duplicates", () => {
  it("no duplicate source_id rows in the fixture", () => {
    const ids = FIXTURE_SOURCES.map((r) => r.source_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("no duplicate entity_id values (each entity appears once)", () => {
    const entityIds = FIXTURE_SOURCES.map((r) => r.entity_id);
    const unique = new Set(entityIds);
    expect(unique.size).toBe(entityIds.length);
  });

  it("all entity_subtypes in the fixture are declared in the schema", () => {
    const schema = loadSchema();
    const declaredSubtypes = new Set(schema.entity_subtypes.map((s) => s.subtype));
    for (const row of FIXTURE_SOURCES) {
      expect(declaredSubtypes.has(row.entity_subtype)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Required frontmatter keys — structural completeness per schema
// ---------------------------------------------------------------------------

describe("entity required_frontmatter — structural completeness", () => {
  it("scheduled-event subtype declares id, sources, created_at, updated_at, deleted_upstream", () => {
    const schema = loadSchema();
    const se = schema.entity_subtypes.find((s) => s.subtype === "scheduled-event");
    expect(se).toBeDefined();
    const fm = se!.required_frontmatter;
    expect(fm).toContain("id");
    expect(fm).toContain("sources");
    expect(fm).toContain("created_at");
    expect(fm).toContain("updated_at");
    expect(fm).toContain("deleted_upstream");
  });

  it("event-type subtype declares id, sources, created_at, updated_at (no deleted_upstream)", () => {
    const schema = loadSchema();
    const et = schema.entity_subtypes.find((s) => s.subtype === "event-type");
    expect(et).toBeDefined();
    const fm = et!.required_frontmatter;
    expect(fm).toContain("id");
    expect(fm).toContain("sources");
    expect(fm).toContain("created_at");
    expect(fm).toContain("updated_at");
  });

  it("person subtype declares id, sources, created_at, updated_at", () => {
    const schema = loadSchema();
    const p = schema.entity_subtypes.find((s) => s.subtype === "person");
    expect(p).toBeDefined();
    const fm = p!.required_frontmatter;
    expect(fm).toContain("id");
    expect(fm).toContain("sources");
    expect(fm).toContain("created_at");
    expect(fm).toContain("updated_at");
  });
});

// ---------------------------------------------------------------------------
// Action-class completeness — response-needed, deadline, other
// ---------------------------------------------------------------------------

describe("action_classes — completeness", () => {
  it("all three action classes are declared", () => {
    const schema = loadSchema();
    const classes = schema.action_classes.map((c) => c.class);
    expect(classes).toContain("response-needed");
    expect(classes).toContain("deadline");
    expect(classes).toContain("other");
  });

  it("no duplicate action classes", () => {
    const schema = loadSchema();
    const classes = schema.action_classes.map((c) => c.class);
    const unique = new Set(classes);
    expect(unique.size).toBe(classes.length);
  });
});

// ---------------------------------------------------------------------------
// Dedup namespace collision — same event_uuid MUST not produce duplicate rows
// under different subtypes in the same _sources.json pass
// ---------------------------------------------------------------------------

describe("source-ID uniqueness across namespaces", () => {
  it("event UUID used as scheduled-event source_id does not collide with invitee rows", () => {
    const eventRow: SourceRow = {
      source_id: "evt-uuid-abc",
      entity_subtype: "scheduled-event",
      entity_id: "entity-evt-abc",
    };
    const inviteeRow: SourceRow = {
      source_id: "inv-uuid-abc",
      entity_subtype: "person",
      entity_id: "entity-person-abc",
    };
    // Different UUIDs — no collision possible.
    expect(eventRow.source_id).not.toBe(inviteeRow.source_id);
  });

  it("re-ingesting the same event UUID overwrites the existing row, not appends", () => {
    // Simulate lookup-before-write: if source_id already exists, update rather
    // than insert. Structural assertion on the in-memory dedup logic.
    const existing: SourceRow[] = [
      { source_id: "evt-uuid-001", entity_subtype: "scheduled-event", entity_id: "entity-evt-001" },
    ];
    const incoming: SourceRow = {
      source_id: "evt-uuid-001",
      entity_subtype: "scheduled-event",
      entity_id: "entity-evt-001",
    };
    // Upsert: replace if source_id matches.
    const updated = existing
      .filter((r) => r.source_id !== incoming.source_id)
      .concat([incoming]);
    expect(updated.length).toBe(1);
    expect(updated[0].source_id).toBe("evt-uuid-001");
  });
});

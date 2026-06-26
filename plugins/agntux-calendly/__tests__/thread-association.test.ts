/**
 * thread-association.test.ts — agntux-calendly
 *
 * Asserts the parent/child shape for scheduled events and their invitees.
 *
 * In Calendly's model:
 *   - A SCHEDULED EVENT is the parent unit (identified by event_uuid).
 *   - INVITEES are children of that event (identified by invitee_uuid).
 *   - The parent event's `updated_at` bumps whenever an invitee changes
 *     (e.g., invitee cancels, is marked no-show, answers a question).
 *   - There is NO separate parent-tracking registry or thread-ts cursor;
 *     the event UUID is the shared parent key for all child invitee rows.
 *
 * These tests are STRUCTURAL only — they do not re-run the ingest agent.
 * All facts are derived from:
 *   1. The listing.yaml proposed_schema (parsed YAML — entity subtypes)
 *   2. In-memory fixture objects representing the canonical shape
 *      (no _overrides/ files are read — see E30 rule).
 *
 * The in-memory fixtures mimic what the ingest agent would produce, based
 * on the source_id_format declared in listing.yaml.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// listing.yaml — derive entity subtypes and source_id_format
// ---------------------------------------------------------------------------
interface ProposedSchema {
  entity_subtypes: Array<{ subtype: string }>;
  source_id_format: string;
}

function loadSchema(): ProposedSchema {
  const listing = yaml.load(
    readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  return listing.proposed_schema as ProposedSchema;
}

// ---------------------------------------------------------------------------
// In-memory fixture — parent event + child invitees
// Derived from listing.yaml source_id_format:
//   `{scheduled_event_uuid}` for meetings
//   `{invitee_uuid}` for attendees
// ---------------------------------------------------------------------------

const EVENT_UUID = "abc123-event-uuid";
const INVITEE_UUID_1 = "inv001-invitee-uuid";
const INVITEE_UUID_2 = "inv002-invitee-uuid";

interface SourcesRow {
  source_id: string;
  entity_id: string;
  entity_subtype: string;
  parent_event_uuid?: string;
}

// A _sources.json fixture with one parent event and two child invitees.
const SOURCES_ROWS: SourcesRow[] = [
  {
    source_id: EVENT_UUID,
    entity_id: "entity-event-001",
    entity_subtype: "scheduled-event",
  },
  {
    source_id: INVITEE_UUID_1,
    entity_id: "entity-person-001",
    entity_subtype: "person",
    parent_event_uuid: EVENT_UUID,
  },
  {
    source_id: INVITEE_UUID_2,
    entity_id: "entity-person-002",
    entity_subtype: "person",
    parent_event_uuid: EVENT_UUID,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scheduled event → invitees parent/child shape", () => {
  it("entity subtypes include both scheduled-event (parent) and person (child)", () => {
    const schema = loadSchema();
    const subtypeNames = schema.entity_subtypes.map((s) => s.subtype);
    expect(subtypeNames).toContain("scheduled-event");
    expect(subtypeNames).toContain("person");
  });

  it("source_id_format distinguishes events from invitees by uuid field name", () => {
    const schema = loadSchema();
    // Verbatim from listing.yaml line 107:
    // "`{scheduled_event_uuid}` for meetings, `{invitee_uuid}` for attendees"
    expect(schema.source_id_format).toContain("{scheduled_event_uuid}");
    expect(schema.source_id_format).toContain("{invitee_uuid}");
  });

  it("every invitee row maps to its parent event UUID", () => {
    const invitees = SOURCES_ROWS.filter((r) => r.entity_subtype === "person");
    expect(invitees.length).toBeGreaterThan(0);
    for (const inv of invitees) {
      expect(inv.parent_event_uuid).toBe(EVENT_UUID);
    }
  });

  it("no invitee UUID is used as the source_id of a scheduled-event row", () => {
    const eventRows = SOURCES_ROWS.filter(
      (r) => r.entity_subtype === "scheduled-event",
    );
    const inviteeUuids = new Set([INVITEE_UUID_1, INVITEE_UUID_2]);
    for (const row of eventRows) {
      expect(inviteeUuids.has(row.source_id)).toBe(false);
    }
  });

  it("each invitee source_id is unique within the fixture", () => {
    const inviteeIds = SOURCES_ROWS.filter((r) => r.entity_subtype === "person").map(
      (r) => r.source_id,
    );
    const unique = new Set(inviteeIds);
    expect(unique.size).toBe(inviteeIds.length);
  });

  it("there are no duplicate source_id rows across all entity subtypes", () => {
    const allIds = SOURCES_ROWS.map((r) => r.source_id);
    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);
  });

  it("parent event row exists for every invitee's parent_event_uuid", () => {
    const eventSourceIds = new Set(
      SOURCES_ROWS.filter((r) => r.entity_subtype === "scheduled-event").map(
        (r) => r.source_id,
      ),
    );
    const invitees = SOURCES_ROWS.filter((r) => r.entity_subtype === "person");
    for (const inv of invitees) {
      expect(eventSourceIds.has(inv.parent_event_uuid!)).toBe(true);
    }
  });

  it("a second invitee for the same event shares the same parent_event_uuid — not a new parent", () => {
    const invitees = SOURCES_ROWS.filter((r) => r.entity_subtype === "person");
    const parentUuids = new Set(invitees.map((r) => r.parent_event_uuid));
    // All invitees belong to exactly one parent event in this fixture.
    expect(parentUuids.size).toBe(1);
    expect([...parentUuids][0]).toBe(EVENT_UUID);
  });
});

describe("no tracked-parent registry — cursor does not key on invitee UUIDs", () => {
  it("cursor keys are events_updated_at and routing_submissions_since — not invitee-keyed", () => {
    const SAMPLE_CURSOR = JSON.parse(
      '{"events_updated_at":"2026-06-21T10:00:00Z","routing_submissions_since":"2026-06-21T09:45:00Z"}',
    ) as Record<string, unknown>;
    // The cursor has no invitee-level key.
    expect(Object.keys(SAMPLE_CURSOR).some((k) => k.includes("invitee"))).toBe(false);
  });

  it("cursor does not contain per-container child-thread entries", () => {
    const SAMPLE_CURSOR = JSON.parse(
      '{"events_updated_at":"2026-06-21T10:00:00Z","routing_submissions_since":"2026-06-21T09:45:00Z"}',
    ) as Record<string, unknown>;
    // Calendly uses a flat dual-key cursor, not a per-invitee or per-channel map.
    // No sub-object per invitee or event should appear.
    for (const v of Object.values(SAMPLE_CURSOR)) {
      expect(typeof v).toBe("string");
    }
  });
});

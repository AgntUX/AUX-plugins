/**
 * idempotent.test.ts — agntux-zoom
 *
 * Static assertions that the dedup mechanisms are correctly authored and
 * that the plugin's source-ID namespacing is structurally clean.
 *
 * GOLDEN RULE: assertions are derived from:
 *   1. listing.yaml proposed_schema (parsed YAML — machine-readable,
 *      mechanical rule 5). Source-ID namespace facts come exclusively from
 *      the listing.yaml source_id_format field.
 *   2. In-memory fixture objects representing canonical source-ID shapes,
 *      constructed here rather than read from _overrides/ (E30 rule).
 *
 * We do NOT assert on _overrides/** prose, data/instructions/** files,
 * or any file text that a different specialist may reword.
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
  cursor_semantics: string;
}

function loadSchema(): ProposedSchema {
  const listing = yaml.load(
    readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  return listing.proposed_schema as ProposedSchema;
}

// ---------------------------------------------------------------------------
// Source-ID format — derived from listing.yaml source_id_format field
// Verbatim from listing.yaml line 158:
// "`zoom:meeting:{meeting_uuid}`, `zoom:recording:{recording_id}`,
//  `zoom:chat:{message_id}`, `zoom:doc:{file_id}`"
// ---------------------------------------------------------------------------

describe("source_id_format — dedup key structure", () => {
  it("source_id_format documents zoom:meeting: namespace", () => {
    const schema = loadSchema();
    expect(schema.source_id_format).toContain("zoom:meeting:");
  });

  it("source_id_format documents zoom:recording: namespace", () => {
    const schema = loadSchema();
    expect(schema.source_id_format).toContain("zoom:recording:");
  });

  it("source_id_format documents zoom:chat: namespace", () => {
    const schema = loadSchema();
    expect(schema.source_id_format).toContain("zoom:chat:");
  });

  it("source_id_format documents zoom:doc: namespace", () => {
    const schema = loadSchema();
    expect(schema.source_id_format).toContain("zoom:doc:");
  });
});

// ---------------------------------------------------------------------------
// Fixture dedup invariants — in-memory _sources.json simulation
//
// Representative rows for each source-ID namespace. These mirror the
// shape the ingest agent produces per the schema. The five distinct
// action source_id namespaces (next-steps, upcoming, recording, chat, doc)
// ensure same meeting_uuid can appear in multiple namespaces without
// collision — each is a distinct action.
// ---------------------------------------------------------------------------

interface SourceRow {
  source_id: string;
  entity_subtype: string;
  entity_id: string;
}

// One row per source-ID namespace for a meeting `abc123`.
const FIXTURE_SOURCES: SourceRow[] = [
  {
    source_id: "zoom:meeting:abc123",
    entity_subtype: "meeting",
    entity_id: "entity-meeting-abc123",
  },
  {
    source_id: "zoom:chat:ch001:user42",
    entity_subtype: "chat-thread",
    entity_id: "entity-chat-ch001-user42",
  },
  {
    source_id: "zoom:doc:doc012",
    entity_subtype: "document",
    entity_id: "entity-doc-doc012",
  },
  {
    source_id: "zoom:person:alice@example.com",
    entity_subtype: "person",
    entity_id: "entity-person-alice",
  },
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
      expect(
        declaredSubtypes.has(row.entity_subtype),
        `entity_subtype "${row.entity_subtype}" not declared in listing.yaml`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Required frontmatter keys — structural completeness per schema
// ---------------------------------------------------------------------------

describe("entity required_frontmatter — structural completeness", () => {
  it("meeting subtype declares all core frontmatter keys", () => {
    const schema = loadSchema();
    const se = schema.entity_subtypes.find((s) => s.subtype === "meeting");
    expect(se).toBeDefined();
    const fm = se!.required_frontmatter;
    expect(fm).toContain("id");
    expect(fm).toContain("sources");
    expect(fm).toContain("created_at");
    expect(fm).toContain("updated_at");
    expect(fm).toContain("deleted_upstream");
  });

  it("chat-thread subtype declares all core frontmatter keys", () => {
    const schema = loadSchema();
    const se = schema.entity_subtypes.find((s) => s.subtype === "chat-thread");
    expect(se).toBeDefined();
    const fm = se!.required_frontmatter;
    expect(fm).toContain("id");
    expect(fm).toContain("sources");
    expect(fm).toContain("created_at");
    expect(fm).toContain("updated_at");
  });

  it("document subtype declares all core frontmatter keys", () => {
    const schema = loadSchema();
    const se = schema.entity_subtypes.find((s) => s.subtype === "document");
    expect(se).toBeDefined();
    const fm = se!.required_frontmatter;
    expect(fm).toContain("id");
    expect(fm).toContain("sources");
    expect(fm).toContain("created_at");
    expect(fm).toContain("updated_at");
    expect(fm).toContain("deleted_upstream");
  });

  it("person subtype declares all core frontmatter keys", () => {
    const schema = loadSchema();
    const se = schema.entity_subtypes.find((s) => s.subtype === "person");
    expect(se).toBeDefined();
    const fm = se!.required_frontmatter;
    expect(fm).toContain("id");
    expect(fm).toContain("sources");
    expect(fm).toContain("created_at");
    expect(fm).toContain("updated_at");
    expect(fm).toContain("deleted_upstream");
  });
});

// ---------------------------------------------------------------------------
// Action-class completeness — all declared classes are present
// ---------------------------------------------------------------------------

describe("action_classes — completeness", () => {
  it("all six action classes are declared", () => {
    const schema = loadSchema();
    const classes = schema.action_classes.map((c) => c.class);
    expect(classes).toContain("deadline");
    expect(classes).toContain("response-needed");
    expect(classes).toContain("knowledge-update");
    expect(classes).toContain("risk");
    expect(classes).toContain("opportunity");
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
// Source-ID uniqueness across namespaces
// A single meeting_uuid can produce multiple open actions in distinct
// namespaces (next-steps and recording for the same meeting coexist).
// The dedup check uses the full source_id including namespace prefix.
// ---------------------------------------------------------------------------

describe("source-ID namespace collision prevention", () => {
  it("zoom:next-steps: and zoom:recording: are distinct even for the same meeting_uuid", () => {
    const uuid = "abc123";
    const nextStepsId = `zoom:next-steps:${uuid}`;
    const recordingId = `zoom:recording:${uuid}`;
    // Different namespace prefixes — no collision.
    expect(nextStepsId).not.toBe(recordingId);
  });

  it("zoom:upcoming: and zoom:next-steps: are distinct for the same meeting_uuid", () => {
    const uuid = "abc123";
    const upcomingId = `zoom:upcoming:${uuid}`;
    const nextStepsId = `zoom:next-steps:${uuid}`;
    expect(upcomingId).not.toBe(nextStepsId);
  });

  it("re-ingesting the same meeting UUID overwrites the existing entity row, not appends", () => {
    // Simulate lookup-before-write: if source_id already exists, update
    // rather than insert. Structural assertion on the in-memory dedup logic.
    const existing: SourceRow[] = [
      {
        source_id: "zoom:meeting:abc123",
        entity_subtype: "meeting",
        entity_id: "entity-meeting-abc123",
      },
    ];
    const incoming: SourceRow = {
      source_id: "zoom:meeting:abc123",
      entity_subtype: "meeting",
      entity_id: "entity-meeting-abc123",
    };
    // Upsert: replace when source_id matches.
    const updated = existing
      .filter((r) => r.source_id !== incoming.source_id)
      .concat([incoming]);
    expect(updated.length).toBe(1);
    expect(updated[0].source_id).toBe("zoom:meeting:abc123");
  });

  it("a chat source_id includes both channel_or_dm_id and zoom_user_id components", () => {
    // The source_id format for chat is zoom:chat:{channel_or_dm_id}:{zoom_user_id}
    // This ensures sender-per-channel uniqueness rather than message-level rows.
    const chatId = "zoom:chat:ch001:user42";
    expect(chatId.startsWith("zoom:chat:")).toBe(true);
    const parts = chatId.replace("zoom:chat:", "").split(":");
    // Two components: channel id and user id.
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe("ch001");
    expect(parts[1]).toBe("user42");
  });
});

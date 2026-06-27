/**
 * thread-association.test.ts — agntux-canva
 *
 * Asserts the parent/child shape for Canva design comments and replies.
 *
 * In Canva's model (as declared in listing.yaml and fetch.md):
 *   - A DESIGN is the top-level container (entity subtype: "design").
 *   - A COMMENT (top-level) is a child of its design, and is the
 *     action-bearing unit (entity subtype: "comment").
 *   - REPLIES are children of a top-level comment and are stored within
 *     the comment entity body — they are NOT separate entities.
 *   - The source_id for a comment row is "<design_id>/<comment_id>".
 *   - The action-item source_ref is "canva:<design_id>/<comment_id>" —
 *     scoped to the comment thread, not the design.
 *   - The design's view_url belongs on suggested_actions[].url only.
 *
 * These tests are STRUCTURAL only — they do not re-run the ingest agent.
 * All facts are derived from:
 *   1. marketplace/listing.yaml proposed_schema (parsed YAML — entity
 *      subtypes, source_id_format).
 *   2. In-memory fixture objects representing the canonical shape.
 *      (No _overrides/ files are read — E30 rule.)
 *
 * Source authority for thread structure:
 *   listing.yaml proposed_schema.source_id_format (verbatim)
 *   listing.yaml proposed_schema.entity_subtypes  (parsed object)
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
  action_classes: Array<{ class: string }>;
  source_id_format: string;
  cursor_semantics: string;
}

function loadSchema(): ProposedSchema {
  const listing = yaml.load(
    readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  return listing.proposed_schema as ProposedSchema;
}

// ---------------------------------------------------------------------------
// In-memory fixture — design + comments + replies
// Derived from listing.yaml source_id_format:
//   "`{design_id}#{comment_id}` — design IDs start with D (11 chars total)"
//
// Note: the source_id_format uses '#' as separator; the source_ref on
// action items uses '<design_id>/<comment_id>' (per fetch.md + cursor.md).
// The fixture below uses the source_ref format for action rows (which is
// what _sources.json and actions/_index.md use as lookup keys).
// ---------------------------------------------------------------------------

const DESIGN_ID = "DABCDEfghij"; // 11 chars, starts with D
const COMMENT_ID_1 = "comment001";
const COMMENT_ID_2 = "comment002";
const REPLY_ID_1 = "reply001"; // reply to comment001 — stored in comment body, not a separate entity

interface SourcesRow {
  source_id: string;       // "<design_id>/<comment_id>" for comments; "<design_id>" for designs
  entity_id: string;
  entity_subtype: string;
  parent_design_id?: string;
}

interface ActionRow {
  source_ref: string;   // "canva:<design_id>/<comment_id>"
  action_class: string;
}

// A _sources.json fixture with one design and two top-level comment rows.
// Replies are embedded inside the comment entity body — no separate row.
const SOURCES_ROWS: SourcesRow[] = [
  {
    source_id: DESIGN_ID,
    entity_id: "entity-design-001",
    entity_subtype: "design",
  },
  {
    source_id: `${DESIGN_ID}/${COMMENT_ID_1}`,
    entity_id: "entity-comment-001",
    entity_subtype: "comment",
    parent_design_id: DESIGN_ID,
  },
  {
    source_id: `${DESIGN_ID}/${COMMENT_ID_2}`,
    entity_id: "entity-comment-002",
    entity_subtype: "comment",
    parent_design_id: DESIGN_ID,
  },
];

// Actions/_index.md fixture rows
const ACTION_ROWS: ActionRow[] = [
  {
    source_ref: `canva:${DESIGN_ID}/${COMMENT_ID_1}`,
    action_class: "response-needed",
  },
  {
    source_ref: `canva:${DESIGN_ID}/${COMMENT_ID_2}`,
    action_class: "knowledge-update",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("entity subtypes — listing.yaml", () => {
  it("entity subtypes include both design (parent) and comment (child)", () => {
    const schema = loadSchema();
    const subtypeNames = schema.entity_subtypes.map((s) => s.subtype);
    expect(subtypeNames).toContain("design");
    expect(subtypeNames).toContain("comment");
  });

  it("source_id_format encodes both design_id and comment_id", () => {
    const schema = loadSchema();
    // Verbatim from listing.yaml line 94:
    // "`{design_id}#{comment_id}` — design IDs start with D (11 chars total)"
    expect(schema.source_id_format).toContain("design_id");
    expect(schema.source_id_format).toContain("comment_id");
  });
});

describe("comment entity → parent design shape", () => {
  it("every comment row maps to its parent design via parent_design_id", () => {
    const comments = SOURCES_ROWS.filter((r) => r.entity_subtype === "comment");
    expect(comments.length).toBeGreaterThan(0);
    for (const comment of comments) {
      expect(comment.parent_design_id).toBe(DESIGN_ID);
    }
  });

  it("no reply ID appears as the source_id of a comment entity row", () => {
    // Replies are embedded in the comment entity body — NOT separate _sources.json rows
    const commentRows = SOURCES_ROWS.filter((r) => r.entity_subtype === "comment");
    for (const row of commentRows) {
      expect(row.source_id).not.toContain(REPLY_ID_1);
    }
  });

  it("design row source_id does not include any comment or reply suffix", () => {
    const designRow = SOURCES_ROWS.find((r) => r.entity_subtype === "design");
    expect(designRow).toBeDefined();
    expect(designRow!.source_id).toBe(DESIGN_ID);
    expect(designRow!.source_id).not.toContain("/");
  });

  it("each comment source_id is unique within the fixture", () => {
    const commentIds = SOURCES_ROWS.filter((r) => r.entity_subtype === "comment").map(
      (r) => r.source_id,
    );
    expect(new Set(commentIds).size).toBe(commentIds.length);
  });

  it("there are no duplicate source_id rows across all entity subtypes", () => {
    const allIds = SOURCES_ROWS.map((r) => r.source_id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("parent design row exists for every comment's parent_design_id", () => {
    const designIds = new Set(
      SOURCES_ROWS.filter((r) => r.entity_subtype === "design").map((r) => r.source_id),
    );
    const comments = SOURCES_ROWS.filter((r) => r.entity_subtype === "comment");
    for (const comment of comments) {
      expect(designIds.has(comment.parent_design_id!)).toBe(true);
    }
  });

  it("two separate top-level comments on the same design produce two distinct source rows", () => {
    const comments = SOURCES_ROWS.filter((r) => r.entity_subtype === "comment");
    expect(comments).toHaveLength(2);
    // Both belong to the same design
    const parentDesigns = new Set(comments.map((r) => r.parent_design_id));
    expect(parentDesigns.size).toBe(1);
    // But they have distinct source_ids
    const commentSourceIds = new Set(comments.map((r) => r.source_id));
    expect(commentSourceIds.size).toBe(2);
  });
});

describe("action source_ref is comment-thread-scoped", () => {
  it("every action source_ref is prefixed with 'canva:' and includes design_id/comment_id", () => {
    // Derived from cursor.md + fetch.md source_ref granularity rule:
    // source_ref: "canva:<design_id>/<comment_id>"
    for (const row of ACTION_ROWS) {
      expect(row.source_ref.startsWith("canva:")).toBe(true);
      expect(row.source_ref).toContain("/");
    }
  });

  it("two different comments produce two different action source_refs", () => {
    const refs = ACTION_ROWS.map((r) => r.source_ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("action source_ref is NOT the design view_url alone", () => {
    // Derived from cursor.md: "The design `view_url` belongs on the `url` field
    // of `suggested_actions` only"
    for (const row of ACTION_ROWS) {
      expect(row.source_ref).not.toMatch(/^https:/);
      expect(row.source_ref).not.toBe(DESIGN_ID);
    }
  });
});

describe("action_classes — listing.yaml", () => {
  it("response-needed class is declared for unresolved comment threads", () => {
    const schema = loadSchema();
    const classNames = schema.action_classes.map((c) => c.class);
    expect(classNames).toContain("response-needed");
  });
});

/**
 * thread-association.test.ts — agntux-notion
 *
 * Static assertions about Notion's thread / parent-child semantics:
 *
 *   - Pages are the top-level thread unit (notion_page).
 *   - Comments are children of pages — stored in ## Comments sections.
 *   - The parent page entity is written to entities/notion_page/ regardless of
 *     whether the comment or the page body is the primary signal.
 *   - notion_comment subtype is used ONLY when the comment itself is the action
 *     signal (e.g. @-mention awaiting reply).
 *   - source_ref on any comment-derived action item always points to the parent
 *     page URL, not the comment id.
 *   - page_id and discussion_id MUST be written to action frontmatter for any
 *     comment-reply action.
 *
 * Source files asserted:
 *   skills/agntux-notion/reference/fetch.md   (rendered — guarded by existsSync)
 *   skills/agntux-notion/reference/cursor.md  (rendered — guarded by existsSync)
 *   marketplace/listing.yaml                  (machine-readable proposed_schema)
 *
 * Assertions against rendered reference files (skills/{slug}/reference/*.md),
 * NOT against _overrides/reference/*.md (E30-clean).
 * No LLM is invoked at test time.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-notion";

// Rendered reference files — produced by render-skill.mjs from canonical + _overrides.
// These paths are NOT _overrides/ paths, so they are E30-clean.
const RENDERED_REF_DIR = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);
const RENDERED_FETCH_MD = join(RENDERED_REF_DIR, "fetch.md");
const RENDERED_CURSOR_MD = join(RENDERED_REF_DIR, "cursor.md");

const listing = yamlLoad(
  readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
) as Record<string, unknown>;

// ── Pages as parent thread units ─────────────────────────────────────────────

describe("pages as parent thread units", () => {
  it("rendered fetch.md declares pages as the top-level thread unit (notion_page)", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return; // pre-render build: skip
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/fetch.md (hyphen-case subtype names as of current render)
    expect(fetchMd).toContain("Notion **pages** are the top-level thread unit (`notion-page`)");
  });

  it("rendered fetch.md declares comment threads are children under the page", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("**comment threads** are children");
  });

  it("rendered fetch.md states the parent page entity is written to entities/notion_page/ on a comment signal", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("When a comment is the primary signal, the parent page is still the entity");
  });

  it("rendered fetch.md stores comments in ## Comments section within the parent entity file", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("`## Comments` section within that entity file");
  });

  it("rendered fetch.md instructs NOT to create a separate entity for each comment", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("Do not create a separate entity");
  });
});

// ── notion_comment subtype usage ─────────────────────────────────────────────

describe("notion_comment subtype — used only when comment is the action signal", () => {
  it("rendered fetch.md limits notion_comment subtype to cases where comment is the action signal", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/fetch.md (hyphen-case subtype names as of current render)
    expect(fetchMd).toContain("use `notion-comment` subtype only when the comment itself");
  });

  it("listing.yaml proposed_schema declares notion-comment as a valid entity subtype", () => {
    // Machine-readable fact from marketplace/listing.yaml proposed_schema.entity_subtypes
    const schema = listing.proposed_schema as Record<string, unknown>;
    const subtypes = schema.entity_subtypes as Array<Record<string, unknown>>;
    const subtypeNames = subtypes.map((s) => s.subtype as string);
    expect(subtypeNames).toContain("notion-comment");
  });

  it("rendered cursor.md documents the source_id for notion_comment entities", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/cursor.md
    expect(cursorMd).toContain("`notion:comment:{comment_uuid}`");
  });

  it("rendered cursor.md source_ref on comment-derived action items points to parent page URL", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain(
      "**The `source_ref` on any action item raised from a comment always points to the",
    );
  });

  it("rendered cursor.md forbids source_ref pointing to the comment id", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("never to the comment id");
  });
});

// ── page_id and discussion_id on comment-reply action frontmatter ─────────────

describe("comment-reply action frontmatter keys", () => {
  it("rendered fetch.md mandates page_id on every comment-reply action item", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/fetch.md
    expect(fetchMd).toContain("MUST\ninclude both of the following frontmatter keys");
  });

  it("rendered fetch.md mandates discussion_id on every comment-reply action item", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("discussion_id: \"{notion_discussion_uuid_dashed}\"");
  });

  it("rendered fetch.md states the view tool passes page_id and discussion_id to notion-create-comment", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain(
      "The view tool passes `page_id` and `discussion_id` directly to",
    );
  });

  it("rendered fetch.md warns: without both keys the handler cannot target the correct thread", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("Without both\nkeys the handler cannot target the correct thread");
  });
});

// ── Update-page action frontmatter keys ──────────────────────────────────────

describe("update-page action frontmatter keys", () => {
  it("rendered fetch.md mandates page_id on every update-page action item", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/fetch.md
    expect(fetchMd).toContain(
      "Every action item whose primary signal is a database item or page requiring a",
    );
    expect(fetchMd).toContain("page_id: \"{notion_page_uuid_dashed}\"");
  });

  it("rendered fetch.md states the view tool passes page_id directly to notion-update-page", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("The view tool passes `page_id` directly to `notion-update-page`");
  });
});

// ── Database items are NOT children of pages ─────────────────────────────────

describe("database items are independent (not children of pages)", () => {
  it("rendered fetch.md states database items are independent entities, not children of pages", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/fetch.md (hyphen-case subtype names as of current render)
    expect(fetchMd).toContain(
      "(`notion-database-item`) are independent entities, not children of pages.",
    );
  });

  it("listing.yaml proposed_schema declares notion-database-item as a valid entity subtype", () => {
    // Machine-readable fact from marketplace/listing.yaml proposed_schema.entity_subtypes
    const schema = listing.proposed_schema as Record<string, unknown>;
    const subtypes = schema.entity_subtypes as Array<Record<string, unknown>>;
    const subtypeNames = subtypes.map((s) => s.subtype as string);
    expect(subtypeNames).toContain("notion-database-item");
  });
});

// ── No tracked-parent registry for comments (seen_comment_ids instead) ────────

describe("no per-page tracked-parent registry — seen_comment_ids FIFO is used instead", () => {
  it("rendered cursor.md states the comment cursor mechanism is a bounded FIFO, not a per-page map", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/cursor.md
    expect(cursorMd).toContain("bounded FIFO of already-processed comment ids");
  });

  it("rendered cursor.md explains Notion page last_edited_time does NOT advance on comment add", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("page's `last_edited_time` is NOT");
  });

  it("rendered fetch.md Step 5g documents comment dedup via seen_comment_ids (not a cursor entry per page)", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/fetch.md
    expect(fetchMd).toContain(
      "Track seen comment ids in `data/learnings/agntux-notion/sync.md` frontmatter",
    );
  });
});

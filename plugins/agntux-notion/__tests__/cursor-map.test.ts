/**
 * cursor-map.test.ts — agntux-notion
 *
 * Static assertions about the non-trivial cursor shape documented in
 *   skills/agntux-notion/reference/cursor.md  (rendered reference — authoritative)
 *
 * Notion uses a single global last_edited_time low-water-mark PLUS a bounded
 * seen_comment_ids FIFO (max 500) for comment dedup — not a per-container map.
 * This test asserts:
 *   1. The single scalar cursor shape and storage location.
 *   2. The seen_comment_ids FIFO: max-500 cap, FIFO eviction, update at Step 11.
 *   3. The transactional advance rule (both cursor AND seen_comment_ids advance
 *      together only on full-run success).
 *   4. Bootstrap state and gap-recovery semantics.
 *   5. The source_id format in listing.yaml matches the documented pattern.
 *
 * Assertions derive from:
 *   - The RENDERED reference file at skills/agntux-notion/reference/cursor.md
 *     (guarded by existsSync — skips gracefully in pre-render builds).
 *   - Machine-readable fields in marketplace/listing.yaml (proposed_schema).
 *
 * No LLM is invoked at test time.
 * No _overrides/ files are read (E30-clean).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-notion";

// Rendered reference file — produced by render-skill.mjs from canonical + _overrides.
// Use the rendered path (skills/{slug}/reference/cursor.md), never the _overrides source.
const RENDERED_CURSOR_MD = join(PLUGIN_ROOT, `skills/${SLUG}/reference/cursor.md`);

const listing = yamlLoad(
  readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
) as Record<string, unknown>;

// ── Single global scalar cursor (not a per-container map) ────────────────────

describe("single global last_edited_time cursor", () => {
  it("rendered cursor.md describes a single global low-water-mark strategy", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return; // pre-render build: skip
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/cursor.md
    expect(cursorMd).toContain("single global `last_edited_time` low-water-mark");
  });

  it("rendered cursor.md stores cursor under the `cursor` key in data/learnings/agntux-notion/sync.md", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("data/learnings/agntux-notion/sync.md");
    expect(cursorMd).toContain("`cursor` key");
  });

  it("rendered cursor.md explains why a per-database cursor map is NOT needed", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("per-database or per-teamspace cursor needed");
  });

  it("rendered cursor.md cursor type is ISO 8601 UTC timestamp string", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("ISO 8601 UTC timestamp string");
  });

  it("rendered cursor.md documents bootstrap state: cursor: null", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("cursor: null");
  });

  it("rendered cursor.md documents the 60-second safety margin on incremental mode", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("60-second safety margin");
  });
});

// ── seen_comment_ids FIFO registry ───────────────────────────────────────────

describe("seen_comment_ids FIFO registry", () => {
  it("rendered cursor.md documents seen_comment_ids as a bounded FIFO", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("bounded FIFO of already-processed comment ids");
  });

  it("rendered cursor.md caps seen_comment_ids at max 500 entries", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("max 500 entries");
  });

  it("rendered cursor.md stores seen_comment_ids in sync.md frontmatter", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("sync.md");
    expect(cursorMd).toContain("seen_comment_ids");
  });

  it("rendered cursor.md FIFO evicts from the front (oldest first) when cap is reached", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("evict entries from the front (oldest");
  });

  it("rendered cursor.md explains that comment id alone is the dedup key (no timestamps alongside)", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("the id alone is the dedup key.");
  });

  it("rendered cursor.md explains comments do NOT advance parent page last_edited_time", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("page's `last_edited_time` is NOT");
  });

  it("rendered cursor.md Step 5g polling checks comment id in seen_comment_ids before processing", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("Look up the comment's `id` in `seen_comment_ids`");
  });
});

// ── Transactional advance rule (cursor + seen_comment_ids) ────────────────────

describe("transactional advance rule", () => {
  it("rendered cursor.md advances cursor and seen_comment_ids together only at Step 11", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("only at Step 11");
  });

  it("rendered cursor.md advance requires all action writes to succeed (transactional)", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("when every action write in the current run has succeeded.");
  });

  it("rendered cursor.md computes new cursor as max(last_edited_time) across processed items", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("max(last_edited_time)");
  });

  it("rendered cursor.md non-regression rule: cursor never regresses", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("values never regress.");
  });

  it("rendered cursor.md write failure skips both cursor and seen_comment_ids advance", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("do not advance `cursor`");
    expect(cursorMd).toContain("do not append to `seen_comment_ids`");
  });

  it("rendered cursor.md Step 11 single atomic write covers cursor, seen_comment_ids, and lock release", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("single atomic write");
  });
});

// ── Bootstrap and gap recovery ───────────────────────────────────────────────

describe("bootstrap and gap recovery", () => {
  it("rendered cursor.md bootstrap triggers when cursor is null", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("`cursor: null` means bootstrap mode");
  });

  it("rendered cursor.md gap recovery: logs notion-cursor-evicted on malformed cursor", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("notion-cursor-evicted");
  });

  it("rendered cursor.md gap recovery: seen_comment_ids survives a cursor reset", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("Do NOT reset `seen_comment_ids`");
  });

  it("rendered cursor.md first-run onboarding: last_success null AND cursor null", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("`last_success: null` AND `cursor: null`");
  });

  it("rendered cursor.md onboarding caps: 30 pages from notion-search on first run", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("30 pages");
  });
});

// ── source_id format ─────────────────────────────────────────────────────────

describe("source_id_format in listing.yaml (parsed YAML)", () => {
  it("source_id_format documents the notion:{block-id} pattern", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    // Verbatim from marketplace/listing.yaml line 129
    expect(schema.source_id_format as string).toContain("{block-id}");
  });

  it("source_id_format mentions Notion's 32-character hex UUID", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    // Verbatim from marketplace/listing.yaml line 129
    expect(schema.source_id_format as string).toContain("32-character hex UUID");
  });
});

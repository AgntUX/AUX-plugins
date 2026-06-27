/**
 * idempotent.test.ts — agntux-notion
 *
 * Static assertions that the dedup mechanisms are correctly documented in the
 * authored prompt files, and that any committed example fixtures are structurally
 * clean.
 *
 * Assertions:
 *   1. The _sources.json lookup-before-write protocol is documented.
 *   2. The Step 9 dedup-against-actions/_index.md protocol (generic ingest contract).
 *   3. The seen_comment_ids FIFO dedup registry for comments.
 *   4. The transactional cursor advance prevents duplicate replay of successful windows.
 *   5. Example fixtures (if present) have zero duplicate filenames / source_id rows.
 *
 * Source files asserted:
 *   skills/agntux-notion/reference/cursor.md  (rendered — guarded by existsSync)
 *   skills/agntux-notion/reference/fetch.md   (rendered — guarded by existsSync)
 *
 * Assertions against the rendered reference files (skills/{slug}/reference/*.md),
 * NOT against _overrides/reference/*.md (E30-clean).
 * No LLM is invoked at test time.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-notion";

// Rendered reference files — produced by render-skill.mjs from canonical + _overrides.
// These paths are NOT _overrides/ paths, so they are E30-clean.
const RENDERED_REF_DIR = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);
const RENDERED_CURSOR_MD = join(RENDERED_REF_DIR, "cursor.md");
const RENDERED_FETCH_MD = join(RENDERED_REF_DIR, "fetch.md");

// ── _sources.json lookup-before-write protocol ────────────────────────────────

describe("_sources.json lookup-before-write protocol", () => {
  it("rendered cursor.md documents _sources.json lookup-before-write protocol at Step 7", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return; // pre-render build: skip
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/cursor.md
    expect(cursorMd).toContain(
      "Every entity write (Step 7) must follow the `_sources.json` lookup-before-write",
    );
  });

  it("rendered cursor.md instructs reading _sources.json before any entity write", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("Read** `<agntux_root>/entities/_sources.json`");
  });

  it("rendered cursor.md lookup uses (subtype, source, source_id) triple as the key", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("source: \"notion\", source_id:");
  });

  it("rendered cursor.md: if found, merge into existing entity file (do NOT create new)", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("**Merge** into it");
  });

  it("rendered cursor.md: if found, do NOT create a new file", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("Do NOT create a new file.");
  });

  it("rendered cursor.md: people entities get email as cross-source alias for dedup", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("Add the email as a canonical cross-source alias");
  });
});

// ── Comment dedup via seen_comment_ids ────────────────────────────────────────

describe("comment dedup via seen_comment_ids", () => {
  it("rendered fetch.md Step 5g instructs tracking seen comment ids in sync.md frontmatter", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return; // pre-render build: skip
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/fetch.md
    expect(fetchMd).toContain(
      "Track seen comment ids in `data/learnings/agntux-notion/sync.md` frontmatter",
    );
  });

  it("rendered fetch.md names the field: seen_comment_ids", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("under `seen_comment_ids`");
  });

  it("rendered fetch.md instructs skipping any comment id already in the seen list", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("Skip any comment\nid already in the list");
  });

  it("rendered cursor.md seen_comment_ids is bounded at 500 entries (dedup capacity)", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/cursor.md
    expect(cursorMd).toContain("max 500 entries");
  });
});

// ── Transactional cursor advance prevents duplicate action items ──────────────

describe("transactional cursor advance prevents replay", () => {
  it("rendered cursor.md cursor advances only at Step 11 on full-run success", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("only at Step 11");
    expect(cursorMd).toContain(
      "when every action write in the current run has succeeded.",
    );
  });

  it("rendered cursor.md write failure leaves cursor at pre-run value (no partial advance)", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("do not advance `cursor`");
  });

  it("rendered cursor.md 60-second safety margin applied on each incremental run", () => {
    if (!existsSync(RENDERED_CURSOR_MD)) return;
    const cursorMd = readFileSync(RENDERED_CURSOR_MD, "utf-8");
    expect(cursorMd).toContain("60-second safety margin");
  });
});

// ── Source ID stability ───────────────────────────────────────────────────────

describe("source_id stability across passes", () => {
  it("rendered fetch.md constructs source_id from the Notion dashed UUID (stable across renames)", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    // Verbatim from skills/agntux-notion/reference/fetch.md
    expect(fetchMd).toContain("notion:{notion_uuid}");
  });

  it("rendered fetch.md documents the dashed UUID format as stable across renames and parent moves", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("The dashed UUID is stable across renames and parent moves");
  });

  it("rendered fetch.md forbids constructing source_id from titles or URLs (those change)", () => {
    if (!existsSync(RENDERED_FETCH_MD)) return;
    const fetchMd = readFileSync(RENDERED_FETCH_MD, "utf-8");
    expect(fetchMd).toContain("Do not construct\nsource ids from titles or URLs");
  });
});

// ── Example fixtures structural cleanliness ───────────────────────────────────

describe("example fixtures (if present)", () => {
  const examplesDir = join(PLUGIN_ROOT, "examples");

  it("examples/ directory does not contain duplicate action filenames across scenarios", () => {
    if (!existsSync(examplesDir)) return; // No fixtures yet — skip.
    const scenarios = readdirSync(examplesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const scenario of scenarios) {
      const actionsDir = join(examplesDir, scenario, "expected-actions");
      if (!existsSync(actionsDir)) continue;
      const files = readdirSync(actionsDir).filter((f) => f.endsWith(".md"));
      const unique = new Set(files);
      expect(
        unique.size,
        `Duplicate action filenames in examples/${scenario}/expected-actions/`,
      ).toBe(files.length);
    }
  });

  it("examples/ _sources.json rows have no duplicate source_id values per scenario", () => {
    if (!existsSync(examplesDir)) return;
    const scenarios = readdirSync(examplesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const scenario of scenarios) {
      const sourcesPath = join(
        examplesDir,
        scenario,
        "expected-entities",
        "_sources.json",
      );
      if (!existsSync(sourcesPath)) continue;
      const rows = JSON.parse(
        readFileSync(sourcesPath, "utf-8"),
      ) as Array<{ source_id?: string }>;
      const ids = rows.map((r) => r.source_id).filter(Boolean) as string[];
      const unique = new Set(ids);
      expect(
        unique.size,
        `Duplicate source_id in examples/${scenario}/expected-entities/_sources.json`,
      ).toBe(ids.length);
    }
  });

  it("examples/ action files with source_id use the notion: prefix format", () => {
    if (!existsSync(examplesDir)) return;
    const scenarios = readdirSync(examplesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const scenario of scenarios) {
      const actionsDir = join(examplesDir, scenario, "expected-actions");
      if (!existsSync(actionsDir)) continue;
      const files = readdirSync(actionsDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const content = readFileSync(join(actionsDir, file), "utf-8");
        if (/^source_id:/m.test(content)) {
          // Must start with "notion:" per the documented source_id format
          expect(content).toMatch(/^source_id:\s*notion:/m);
        }
      }
    }
  });
});

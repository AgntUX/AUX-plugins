/**
 * idempotent.test.ts — agntux-sentry
 *
 * Static assertions that the deduplication mechanisms are correctly
 * documented in the rendered skill tree. All assertions are grounded in
 * verbatim substrings from the rendered reference files — confirmed by
 * reading the source before authoring. No LLM at test time.
 *
 * Asserted files (rendered, never _overrides/):
 *   skills/agntux-sentry/reference/cursor.md    — _sources.json dedup protocol
 *   skills/agntux-sentry/SKILL.md + reference/  — generic dedup anchors
 *
 * Per the golden rule, only GENERIC dedup anchors are asserted (anchors that
 * every ingest plugin shares: lookup-before-write, _sources.json, cursor
 * advance at Step 11). Source-specific prose that ingest-prompt-author may
 * reword is NOT asserted.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-sentry";
const SKILL_ROOT = join(PLUGIN_ROOT, `skills/${SLUG}`);
const REF_DIR = join(SKILL_ROOT, "reference");

// ── Reference-fold helper ─────────────────────────────────────────────────────
// Folds SKILL.md and all reference/*.md into a single searchable string.
// This pattern is specified in the tests-author system prompt.
// Returns an empty string when the rendered tree is absent (pre-render run).

function loadSkillFolded(): string {
  const skillPath = join(SKILL_ROOT, "SKILL.md");
  if (!existsSync(skillPath)) return "";
  const skill = readFileSync(skillPath, "utf8");
  if (!existsSync(REF_DIR)) return skill;
  const refs = readdirSync(REF_DIR)
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map(
      (n) =>
        `<!-- ${n} -->\n${readFileSync(join(REF_DIR, n), "utf8")}`,
    );
  return `${skill}\n${refs.join("\n")}`;
}

// Read the rendered cursor.md directly — it is the authoritative runtime
// copy of the cursor protocol and contains the dedup anchors.
// This file is created by render-skill.mjs (the build/render step) and is
// guaranteed to exist when the tests stage runs in the gate pipeline.
const CURSOR_MD_PATH = join(REF_DIR, "cursor.md");
const CURSOR_DOC = existsSync(CURSOR_MD_PATH)
  ? readFileSync(CURSOR_MD_PATH, "utf-8")
  : "";

// ── describe: _sources.json lookup-before-write (generic dedup) ───────────────

describe("dedup mechanism — _sources.json lookup-before-write", () => {
  it("rendered cursor.md documents _sources.json lookup-before-write protocol", () => {
    // Verbatim from skills/agntux-sentry/reference/cursor.md §4
    expect(CURSOR_DOC).toContain("_sources.json");
    expect(CURSOR_DOC).toContain("lookup-before-write");
  });

  it("rendered cursor.md documents that lookup-before-write prevents duplicate entity files", () => {
    // Verbatim from cursor.md §4
    expect(CURSOR_DOC).toContain("duplicate entity");
  });

  it("rendered cursor.md documents source_id key shape: sentry:{shortId}", () => {
    // Verbatim from cursor.md §4 — source_id construction
    expect(CURSOR_DOC).toContain("sentry:");
    expect(CURSOR_DOC).toContain("shortId");
  });

  it("rendered cursor.md documents merge-not-create on lookup hit", () => {
    // Verbatim from cursor.md §4 — on lookup hit: merge, do NOT create new file
    expect(CURSOR_DOC).toContain("Do NOT create a new");
  });
});

// ── describe: cursor advance at Step 11 (generic dedup / idempotency) ────────

describe("cursor advances only at Step 11 (transactional gate)", () => {
  it("rendered cursor.md documents cursor advances only at Step 11", () => {
    // Verbatim from cursor.md §3 — "The cursor advances only at Step 11"
    expect(CURSOR_DOC).toContain("Step 11");
  });

  it("folded skill body references Step 11 (advance gate)", () => {
    const folded = loadSkillFolded();
    expect(folded).toContain("Step 11");
  });
});

// ── describe: actions/_index.md dedup (Step 9) ───────────────────────────────

describe("dedup against actions/_index.md (Step 9 equivalent)", () => {
  it("folded skill body references actions/_index.md as the dedup index", () => {
    // The canonical sync pipeline checks actions/_index.md in Step 9.
    // The folded skill must reference it.
    const folded = loadSkillFolded();
    expect(folded).toContain("actions/_index.md");
  });

  it("rendered cursor.md documents that re-surfacing issues are deduplicated via _sources.json", () => {
    // Verbatim from cursor.md §4 last paragraph: the safety-margin 1s overlap
    // means already-processed issues may re-surface; _sources.json absorbs them.
    expect(CURSOR_DOC).toContain("_sources.json");
    // Also confirmed: "absorbs them without creating duplicates"
    expect(CURSOR_DOC).toContain("without creating duplicates");
  });
});

// ── describe: no phantom {{placeholders}} in rendered skill tree ───────────────

describe("no phantom placeholders in rendered skill tree", () => {
  it("SKILL.md has no unsubstituted {{...}} placeholders", () => {
    const skill = readFileSync(join(SKILL_ROOT, "SKILL.md"), "utf-8");
    expect(skill.match(/\{\{[a-z-]+\}\}/g)).toBeNull();
  });

  it("reference/cursor.md has no unsubstituted {{...}} placeholders", () => {
    expect(CURSOR_DOC.match(/\{\{[a-z-]+\}\}/g)).toBeNull();
  });

  it("all rendered reference/*.md files have no unsubstituted {{...}} placeholders", () => {
    if (!existsSync(REF_DIR)) return;
    const files = readdirSync(REF_DIR).filter((n) => n.endsWith(".md"));
    for (const name of files) {
      const text = readFileSync(join(REF_DIR, name), "utf-8");
      expect(
        text.match(/\{\{[a-z-]+\}\}/g),
        `Placeholder found in reference/${name}`,
      ).toBeNull();
    }
  });
});

// idempotent.test.ts — dedup mechanism assertions for agntux-apple-notes.
//
// Static assertions that the dedup contract is documented in the rendered
// skill tree. No LLM is invoked; vitest reads the rendered files directly.
//
// Assertions are grounded in:
//   1. The rendered skills/agntux-apple-notes/ tree (SKILL.md + reference/*.md).
//   2. listing.yaml parsed proposed_schema fields.
//
// Generic dedup anchors (stable across every ingest plugin): _sources.json,
// lookup-before-write, advance the cursor. Source-specific phrases are
// copied verbatim from the rendered files (read-then-copy-literal rule).
//
// E30 guard: ZERO assertions touch _overrides/ source files.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-apple-notes";
const SKILL_DIR = join(PLUGIN_ROOT, `skills/${SLUG}`);
const LISTING_YAML = join(PLUGIN_ROOT, "marketplace/listing.yaml");

// ── Reference-fold helper ─────────────────────────────────────────────────────

/**
 * Fold the rendered SKILL.md + all reference/*.md into a single string so
 * grep-style assertions match content across the rendered tree boundary.
 * Only runs when the rendered tree exists.
 */
function loadSkillFolded(): string | null {
  if (!existsSync(join(SKILL_DIR, "SKILL.md"))) return null;
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  const refDir = join(SKILL_DIR, "reference");
  if (!existsSync(refDir)) return skill;
  const refs = readdirSync(refDir)
    .filter((n) => n.endsWith(".md"))
    .sort();
  const folded = refs
    .map(
      (n) =>
        `<!-- ${n} -->\n${readFileSync(join(refDir, n), "utf8")}`,
    )
    .join("\n");
  return `${skill}\n${folded}`;
}

// ── listing.yaml proposed_schema — action classes ─────────────────────────────

describe("idempotency — listing.yaml action classes", () => {
  it("proposed_schema.action_classes declares two entries both with class: other, distinguished by description", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const classes = ps.action_classes as Array<Record<string, unknown>>;
    expect(Array.isArray(classes)).toBe(true);
    // Verbatim from listing.yaml proposed_schema.action_classes: both entries use class: other
    expect(classes).toHaveLength(2);
    expect(classes[0].class).toBe("other");
    expect(classes[1].class).toBe("other");
    // Verbatim description substrings from listing.yaml proposed_schema.action_classes[].description
    expect(classes[0].description as string).toContain("Create a new note in Apple Notes.");
    expect(classes[1].description as string).toContain("Update an existing note or check off checklist items.");
  });
});

// ── Rendered skill tree — dedup anchors ──────────────────────────────────────

describe("idempotency — rendered skill tree dedup contract", () => {
  function skipIfNotRendered(folded: string | null) {
    if (folded === null) {
      console.warn(
        `idempotent: skipping rendered-tree assertions — skills/${SLUG}/SKILL.md not found yet. Run render-skill.mjs first.`,
      );
      return true;
    }
    return false;
  }

  it("_sources.json is referenced in the rendered skill body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Generic canonical anchor — present in every ingest skill
    expect(folded).toContain("_sources.json");
  });

  it("lookup-before-write protocol is referenced in the rendered skill body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Generic canonical anchor — present in every ingest skill
    expect(folded).toContain("lookup-before-write");
  });

  it("cursor advance step is documented in the rendered skill body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Generic anchor — the advance rule is present in every ingest skill
    expect(folded).toContain("advance the cursor");
  });

  it("date normalisation requirement is documented (Apple Notes specific)", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md (section header)
    expect(folded).toContain(
      "Date normalisation (required before any cursor comparison)",
    );
  });

  it("200-note per-run cap is documented", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md advance rule
    expect(folded).toContain("200 notes");
  });

  it("apple-notes-date-parse-failed error kind is documented", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md normalisation procedure
    expect(folded).toContain("apple-notes-date-parse-failed");
  });

  it("apple-notes-title-collision error kind is documented", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md edge cases section
    expect(folded).toContain("apple-notes-title-collision");
  });

  it("no tracked-parent registry is noted as not applicable", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md
    expect(folded).toContain("No tracked-parent registry");
  });
});

// ── Rendered SKILL.md frontmatter ─────────────────────────────────────────────

describe("idempotency — rendered SKILL.md shape", () => {
  it("rendered SKILL.md exists and declares the correct plugin name", () => {
    if (!existsSync(join(SKILL_DIR, "SKILL.md"))) {
      console.warn(`idempotent: skipping — SKILL.md not found`);
      return;
    }
    const text = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    // Verbatim from agntux-apple-notes-view.ts / listing.yaml slug
    expect(text).toContain("agntux-apple-notes");
  });

  it("no unsubstituted placeholders remain in the rendered SKILL.md", () => {
    if (!existsSync(join(SKILL_DIR, "SKILL.md"))) return;
    const text = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    const matches = text.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("no unsubstituted placeholders remain in any reference/*.md", () => {
    const refDir = join(SKILL_DIR, "reference");
    if (!existsSync(refDir)) return;
    const files = readdirSync(refDir).filter((n) => n.endsWith(".md"));
    for (const f of files) {
      const content = readFileSync(join(refDir, f), "utf8");
      const matches = content.match(/\{\{[a-z-]+\}\}/g);
      expect(
        matches,
        `unsubstituted placeholder in reference/${f}`,
      ).toBeNull();
    }
  });
});

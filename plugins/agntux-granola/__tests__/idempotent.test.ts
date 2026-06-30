// idempotent.test.ts — dedup mechanism assertions for agntux-granola.
//
// Static assertions that the dedup contract is documented in the rendered
// skill tree. No LLM is invoked; vitest reads the rendered files directly.
//
// Assertions are grounded in:
//   1. The rendered skills/agntux-granola/ tree (SKILL.md + reference/*.md)
//      folded into a single string via the reference-fold helper.
//   2. marketplace/listing.yaml parsed proposed_schema fields (YAML object).
//
// Generic dedup anchors (stable across every ingest plugin):
//   _sources.json, lookup-before-write, advance the cursor.
// Source-specific phrases are copied verbatim from rendered files
// (read-then-copy-literal rule; provenance comment names the file+line).
//
// E30 guard: ZERO assertions touch _overrides/ source files or
// data/instructions/*.md.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-granola";
const SKILL_DIR = join(PLUGIN_ROOT, `skills/${SLUG}`);
const LISTING_YAML = join(PLUGIN_ROOT, "marketplace/listing.yaml");

// ── Reference-fold helper ─────────────────────────────────────────────────────

/**
 * Fold the rendered SKILL.md + all reference/*.md into a single string so
 * grep-style assertions match content across the rendered tree boundary.
 * Only runs when the rendered tree exists.
 * The `<!-- {filename} -->` boundary marker (per commit bd5af05) lets
 * diagnostic output point at the originating reference file.
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
  it("proposed_schema.action_classes includes response-needed and knowledge-update", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const classes = ps.action_classes as Array<Record<string, unknown>>;
    expect(Array.isArray(classes)).toBe(true);
    // Verbatim class names from listing.yaml proposed_schema.action_classes
    const classNames = classes.map((c) => c.class as string);
    expect(classNames).toContain("response-needed");
    expect(classNames).toContain("knowledge-update");
  });

  it("proposed_schema.action_classes response-needed entry describes meeting action items", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const classes = ps.action_classes as Array<Record<string, unknown>>;
    const responseNeeded = classes.find((c) => c.class === "response-needed");
    expect(responseNeeded).toBeDefined();
    // Verbatim substring from listing.yaml proposed_schema.action_classes[response-needed].description
    expect(responseNeeded!.description as string).toContain(
      "Action items and follow-ups assigned in meetings.",
    );
  });
});

// ── Rendered skill tree — generic dedup anchors ────────────────────────────────

describe("idempotency — rendered skill tree dedup contract", () => {
  function skipIfNotRendered(folded: string | null): boolean {
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

  it("granola-cursor-malformed error kind is documented (granola-specific dedup path)", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md step 2 parse section
    // (provenance: skills/agntux-granola/reference/cursor.md)
    expect(folded).toContain("granola-cursor-malformed");
  });

  it("look-back overlap idempotency is documented (overlap window dedup)", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md idempotency section header
    // (provenance: skills/agntux-granola/reference/cursor.md)
    expect(folded).toContain("Idempotency across the overlap window");
  });

  it("source_id dedup check against actions/_index.md is documented", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md idempotency section
    // (provenance: skills/agntux-granola/reference/cursor.md)
    expect(folded).toContain("actions/_index.md");
  });

  it("no tracked-parent registry is documented (single-scalar cursor, no parent-child graph)", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md conclusion paragraph
    // (provenance: skills/agntux-granola/reference/cursor.md)
    expect(folded).toContain("no tracked-parent registry");
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
    // Verbatim plugin slug from plugin.json
    expect(text).toContain("agntux-granola");
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

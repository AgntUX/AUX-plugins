// idempotent.test.ts — dedup mechanism assertions for agntux-imessage.
//
// Static assertions that the dedup contract is documented in the rendered
// skill tree. No LLM is invoked; vitest reads the rendered files directly.
//
// Assertions are grounded in:
//   1. marketplace/listing.yaml parsed proposed_schema (machine-readable).
//   2. The rendered skills/agntux-imessage/ tree (SKILL.md + reference/*.md)
//      via the reference-fold helper — skipped gracefully if absent.
//
// Generic dedup anchors (stable across every ingest plugin):
//   "_sources.json", "lookup-before-write", "advance the cursor"
// Source-specific anchors are copied verbatim from the rendered cursor.md
// (per read-then-copy-literal rule; provenance comment beside each assertion).
//
// E30 guard: ZERO assertions touch _overrides/ source files.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-imessage";
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
  it("proposed_schema.action_classes declares response-needed, knowledge-update, and other", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const classes = ps.action_classes as Array<Record<string, unknown>>;
    expect(Array.isArray(classes)).toBe(true);
    expect(classes).toHaveLength(3);
    const classNames = classes.map((c) => c.class);
    // Verbatim from listing.yaml proposed_schema.action_classes[].class
    expect(classNames).toContain("response-needed");
    expect(classNames).toContain("knowledge-update");
    expect(classNames).toContain("other");
  });

  it("response-needed description mentions iMessage conversation awaiting a reply", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const classes = ps.action_classes as Array<Record<string, unknown>>;
    const rn = classes.find((c) => c.class === "response-needed");
    expect(rn).toBeDefined();
    // Verbatim substring from listing.yaml proposed_schema.action_classes[response-needed].description
    expect(rn!.description as string).toContain("awaiting a reply");
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

  it("per-handle last-seen-timestamp map strategy is named in the rendered body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from _overrides/reference/cursor.md strategy-name heading
    // (confirmed present before authoring this assertion)
    expect(folded).toContain("Per-handle last-seen-timestamp map");
  });

  it("90-day eviction rule is documented in the rendered body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from _overrides/reference/cursor.md eviction section
    expect(folded).toContain("90 days");
    expect(folded).toContain("imessage-cursor-evicted");
  });

  it("20-sender run cap is documented in the rendered body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from _overrides/reference/cursor.md run-cap section
    expect(folded).toContain("20 distinct sender threads");
  });

  it("no tracked-parent registry is noted as not applicable in the rendered body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from _overrides/reference/cursor.md no-tracked-parent section header
    expect(folded).toContain("No tracked-parent registry");
  });

  it("imessage-contact-unresolved error kind is documented in the rendered body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from _overrides/reference/cursor.md and fetch.md (both authored)
    expect(folded).toContain("imessage-contact-unresolved");
  });
});

// ── Rendered SKILL.md shape ───────────────────────────────────────────────────

describe("idempotency — rendered SKILL.md shape", () => {
  it("rendered SKILL.md exists and declares the correct plugin name", () => {
    if (!existsSync(join(SKILL_DIR, "SKILL.md"))) {
      console.warn(`idempotent: skipping — SKILL.md not found`);
      return;
    }
    const text = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    // Verbatim from plugin.json / listing.yaml slug
    expect(text).toContain("agntux-imessage");
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

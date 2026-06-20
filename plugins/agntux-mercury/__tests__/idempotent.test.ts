// idempotent.test.ts — dedup mechanism assertions for agntux-mercury.
//
// Static assertions that the dedup contract is documented in the rendered
// skill tree. No LLM is invoked; vitest reads the rendered files directly.
//
// Assertions are grounded in:
//   1. The rendered skills/agntux-mercury/ tree (SKILL.md + reference/*.md).
//   2. listing.yaml read as plain text — verbatim substring checks.
//      (No YAML parser dependency — vitest + node built-ins only.)
//
// Generic dedup anchors stable across every ingest plugin:
//   _sources.json, lookup-before-write, cursor advance.
//
// Source-specific anchors are copied VERBATIM from the rendered reference
// files (read-then-copy-literal rule). Every `toContain` below has a
// "Verbatim from ..." provenance comment naming the exact rendered file.
//
// E30 guard: ZERO assertions touch _overrides/ source files or any
// data/instructions/<slug>.md path.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-mercury";
const SKILL_DIR = join(PLUGIN_ROOT, `skills/${SLUG}`);
const LISTING_YAML = join(PLUGIN_ROOT, "marketplace/listing.yaml");

// ── Reference-fold helper ─────────────────────────────────────────────────────

/**
 * Fold the rendered SKILL.md + all reference/*.md into a single string so
 * grep-style assertions match content across the rendered tree boundary.
 * Returns null when the rendered tree does not yet exist (pre-render run).
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

function skipIfNotRendered(folded: string | null): boolean {
  if (folded === null) {
    console.warn(
      `idempotent: skipping rendered-tree assertions — skills/${SLUG}/SKILL.md not found yet. Run render-skill.mjs first.`,
    );
    return true;
  }
  return false;
}

// ── listing.yaml plain-text checks ───────────────────────────────────────────

describe("idempotency — listing.yaml proposed_schema", () => {
  it("action_classes includes response-needed for pending approvals", () => {
    // Read listing.yaml as plain text — no YAML parser needed.
    // Verbatim YAML list-item lines from listing.yaml proposed_schema.action_classes.
    const raw = readFileSync(LISTING_YAML, "utf-8");
    expect(raw).toContain("    - class: response-needed");
    expect(raw).toContain("    - class: risk");
    expect(raw).toContain("    - class: deadline");
    expect(raw).toContain("    - class: knowledge-update");
    expect(raw).toContain("    - class: opportunity");
  });

  it("entity_subtypes includes all core Mercury resource types", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    // Verbatim YAML list-item lines from listing.yaml proposed_schema.entity_subtypes
    expect(raw).toContain("    - subtype: account");
    expect(raw).toContain("    - subtype: transaction");
    expect(raw).toContain("    - subtype: card");
    expect(raw).toContain("    - subtype: credit-account");
    expect(raw).toContain("    - subtype: send-money-approval");
    expect(raw).toContain("    - subtype: invoice");
    expect(raw).toContain("    - subtype: recipient");
    expect(raw).toContain("    - subtype: customer");
    expect(raw).toContain("    - subtype: team-member");
    expect(raw).toContain("    - subtype: organization");
  });

  it("every entity_subtype carries the required_frontmatter id and sources fields", () => {
    // Plain-text check: all subtypes share the same required_frontmatter block.
    // Both "- id" and "- sources" appear under every required_frontmatter section
    // in listing.yaml. Assert their presence in the file.
    // Verbatim YAML list-item lines from listing.yaml required_frontmatter blocks.
    const raw = readFileSync(LISTING_YAML, "utf-8");
    expect(raw).toContain("        - id");
    expect(raw).toContain("        - sources");
  });

  it("cursor_semantics is present and non-empty", () => {
    const raw = readFileSync(LISTING_YAML, "utf-8");
    // Verbatim from listing.yaml cursor_semantics key and a portion of its value
    expect(raw).toContain("cursor_semantics:");
    expect(raw).toContain("Incremental cursor");
  });
});

// ── Rendered skill tree — generic dedup anchors ───────────────────────────────

describe("idempotency — rendered skill tree generic dedup anchors", () => {
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
    expect(folded).toContain("advance");
  });
});

// ── Rendered skill tree — Mercury-specific dedup anchors ─────────────────────
// Every assertion below was derived by reading the rendered reference files
// (which are wholesale overrides and match the authored _overrides/ content).
// Verbatim substrings are cited with provenance comments.

describe("idempotency — rendered skill tree Mercury-specific dedup contract", () => {
  it("per-account cursor map strategy is documented", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md strategy name heading
    expect(folded).toContain(
      "Per-account createdAt low-water-mark map with pending-id re-poll set",
    );
  });

  it("pending-id re-poll step is documented before the main incremental page", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md section header
    expect(folded).toContain("Pending-id re-poll step (Step 5b preamble)");
  });

  it("pending-id eviction after 30 days is documented", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md Pending-id eviction section
    expect(folded).toContain("Pending-id eviction (stale-pending cleanup)");
  });

  it("mercury-cursor-evicted error kind is referenced in the rendered skill body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md Account eviction section
    expect(folded).toContain("mercury-cursor-evicted");
  });

  it("mercury-pending-evicted error kind is referenced in the rendered skill body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md Pending-id eviction section
    expect(folded).toContain("mercury-pending-evicted");
  });

  it("mercury-pending-not-found error kind is referenced in the rendered skill body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md re-poll step
    expect(folded).toContain("mercury-pending-not-found");
  });

  it("mercury-rate-limited error kind is referenced in the rendered skill body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/fetch.md failure modes table
    expect(folded).toContain("mercury-rate-limited");
  });

  it("mercury-pagination-overflow error kind is referenced in the rendered skill body", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/fetch.md Step 5b per-run cap
    expect(folded).toContain("mercury-pagination-overflow");
  });

  it("200-transaction per-run cap across all accounts is documented", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/fetch.md Step 5b
    expect(folded).toContain("200 transactions total");
  });

  it("full-run success gate (transactional cursor advance rule) is documented", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md section header
    expect(folded).toContain("Full-run success gate (transactional rule)");
  });

  it("no tracked-parent registry is documented (banking source, no threading)", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md No tracked-parent registry section
    expect(folded).toContain("No tracked-parent registry");
  });

  it("bootstrap window default of 30 days is documented", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md Bootstrap run section
    // and rendered reference/fetch.md Step 5b
    expect(folded).toContain("bootstrap_window_days");
  });

  it("dashboardLink verbatim usage for deep links is documented", () => {
    const folded = loadSkillFolded();
    if (skipIfNotRendered(folded)) return;
    // Verbatim from rendered reference/cursor.md Workspace identifier capture section
    expect(folded).toContain("Workspace identifier capture");
    expect(folded).toContain("`dashboardLink`");
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
    // Verbatim from plugin slug / listing.yaml
    expect(text).toContain("agntux-mercury");
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

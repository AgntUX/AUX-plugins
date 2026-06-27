/**
 * thread-association.test.ts
 *
 * Validates that gmail action items use the parent thread id as `source_ref`
 * and that entity-source dedup keys off the thread id, never a per-message id.
 * The lookup-before-write protocol on `_sources.json` is the invariant.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_SLUG = (
  JSON.parse(
    readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
  ) as { name: string }
).name;
const SKILL_PATH = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");

// When reading the slug-named SKILL.md, fold in sibling reference/*.md files
// (sorted) with `<!-- {filename} -->` boundary markers so grep-style
// assertions on procedural body content keep working post-router-split.
// Pass-through for all other paths.
function readSkill(p: string): string {
  if (!existsSync(p)) return "";
  const content = readFileSync(p, "utf-8");
  if (basename(p) === "SKILL.md" && basename(dirname(p)) === PLUGIN_SLUG) {
    const referenceDir = join(dirname(p), "reference");
    if (existsSync(referenceDir)) {
      const parts = [content];
      for (const name of readdirSync(referenceDir).filter((f) => f.endsWith(".md")).sort()) {
        parts.push(`\n<!-- ${name} -->\n`);
        parts.push(readFileSync(join(referenceDir, name), "utf-8"));
      }
      return parts.join("");
    }
  }
  return content;
}

const SKILL_TEXT = readSkill(SKILL_PATH);

describe("source_ref shape", () => {
  it("the sync skill specifies thread_id (NOT a per-message id) as the source_ref", () => {
    expect(SKILL_TEXT).toContain('source_ref: "<thread_id>"');
  });

  it("entity dedup uses the parent thread id as source_id", () => {
    expect(SKILL_TEXT).toMatch(
      /source.*"gmail".*source_id.*<thread_id>/,
    );
  });

  it("declares the lookup-before-write protocol against _sources.json", () => {
    expect(SKILL_TEXT).toContain("_sources.json");
    expect(SKILL_TEXT).toMatch(/lookup.before.write/i);
  });
});

describe("cross-source person merge via email alias", () => {
  it("person entities use email as the canonical cross-source alias", () => {
    expect(SKILL_TEXT).toMatch(/email.*canonical cross.source alias/);
  });

  it("requires the email field on person entity creation", () => {
    expect(SKILL_TEXT).toContain("`email` is **required**");
  });

  it("falls back to email-Grep when _sources.json doesn't have a hit", () => {
    expect(SKILL_TEXT).toMatch(/Grep.*email/i);
  });
});

describe("cross-source action merge", () => {
  it("emits a `## Cross-source links` body section when merging", () => {
    expect(SKILL_TEXT).toContain("## Cross-source links");
  });

  it("uses the namespaced `## Compose payload (gmail)` header on merged actions", () => {
    expect(SKILL_TEXT).toContain("## Compose payload (gmail)");
  });

  it("uses LLM-judged topic overlap, not raw entity overlap, for merge decisions", () => {
    expect(SKILL_TEXT).toMatch(/LLM.judged|topic.overlap/i);
    expect(SKILL_TEXT).toMatch(
      /Person.overlap alone is NOT a sufficient match/i,
    );
  });

  it("Step 8.5 honours cross-source links during auto-resolution", () => {
    // The broadened Step 8.5 (reconcile open items against fresh data) folds the
    // former "Path A / Path B" split into a single candidate scan that includes
    // cross-source-merged actions carrying a `## Cross-source links` body section.
    expect(SKILL_TEXT).toMatch(/cross-source-merged/i);
    expect(SKILL_TEXT).toMatch(/Cross-source links/);
  });
});

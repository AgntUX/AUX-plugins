/**
 * idempotent.test.ts
 *
 * Validates that re-running the sync skill on the same thread state is a
 * no-op for entity files (Recent Activity bullet is updated in-place rather
 * than duplicated) and for action files (dedup against actions/_index.md).
 *
 * Static prompt-grep assertions only — the LLM is not invoked at test time.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_PATH = join(PLUGIN_ROOT, "skills", "sync", "SKILL.md");

// When reading a sync SKILL.md, fold in sibling resources/*.md files (sorted)
// with `<!-- {filename} -->` boundary markers so future Phase-3/4 splits don't
// break grep-style assertions. Pass-through for all other paths.
function readSkill(p: string): string {
  if (!existsSync(p)) return "";
  const content = readFileSync(p, "utf-8");
  if (basename(p) === "SKILL.md" && basename(dirname(p)) === "sync") {
    const resourcesDir = join(dirname(p), "resources");
    if (existsSync(resourcesDir)) {
      const parts = [content];
      for (const name of readdirSync(resourcesDir).filter((f) => f.endsWith(".md")).sort()) {
        parts.push(`\n<!-- ${name} -->\n`);
        parts.push(readFileSync(join(resourcesDir, name), "utf-8"));
      }
      return parts.join("");
    }
  }
  return content;
}

const SKILL_TEXT = readSkill(SKILL_PATH);

describe("idempotent entity update", () => {
  it("Recent Activity bullets cite each thread once per ingest run", () => {
    expect(SKILL_TEXT).toMatch(
      /Cite[\s*]+each thread once per ingest run,\s+not once per reply \/ message/i,
    );
  });

  it("re-touching a known thread updates the existing matching bullet in-place", () => {
    expect(SKILL_TEXT).toMatch(
      /update the\s+existing matching bullet in.place rather than duplicating/i,
    );
  });

  it("section preservation: ## User notes is never overwritten", () => {
    expect(SKILL_TEXT).toMatch(/Never overwrite.*User notes/i);
    expect(SKILL_TEXT).toMatch(/section preservation/i);
  });
});

describe("idempotent action dedup", () => {
  it("scans actions/_index.md and skips creating a duplicate when one is open", () => {
    expect(SKILL_TEXT).toContain("actions/_index.md");
    expect(SKILL_TEXT).toMatch(/do NOT create a duplicate/);
  });

  it("recently-done actions (within 7 days) are not re-raised", () => {
    expect(SKILL_TEXT).toMatch(/Recently done.*7 days/);
  });

  it("recently-dismissed actions are not re-raised", () => {
    expect(SKILL_TEXT).toContain("Recently dismissed");
  });
});

describe("idempotent cursor advance", () => {
  it("cursor advance is per-thread, with the inbox low-water-mark separate", () => {
    expect(SKILL_TEXT).toContain("Inbox discovery low-water-mark");
    expect(SKILL_TEXT).toContain("Thread cursor");
  });

  it("the soft lock guards against concurrent runs corrupting indexes", () => {
    expect(SKILL_TEXT).toContain("soft lock");
    expect(SKILL_TEXT).toMatch(/1 hour ago.*stale/i);
  });
});

describe("idempotent context cache", () => {
  it("Step 10.2 caches per-person context with a 7-day TTL", () => {
    expect(SKILL_TEXT).toMatch(/per.person[\s*]+7.day cache/i);
    expect(SKILL_TEXT).toMatch(/cached_at/);
    expect(SKILL_TEXT).toMatch(/invalidates\s+after 7 days/i);
  });

  it("if the cache is fresh, the search/get_thread call is skipped", () => {
    // The cache lives at data/learnings/agntux-gmail/email-context-cache/<slug>.md.
    // Step 10.2 reads it before searching; if cached_at is within 7 days,
    // the search is skipped.
    expect(SKILL_TEXT).toMatch(
      /email-context-cache\/\{person-slug\}\.md/,
    );
    expect(SKILL_TEXT).toMatch(
      /(?:if the file exists|if a cache row[\s\S]{0,40}exists)[\s\S]{0,80}use the\s+cached preamble[\s\S]{0,30}skip the search/i,
    );
  });
});

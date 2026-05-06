/**
 * thread-association.test.ts
 *
 * Validates that gmail action items use the parent thread id as `source_ref`
 * and that entity-source dedup keys off the thread id, never a per-message id.
 * The lookup-before-write protocol on `_sources.json` is the invariant.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_PATH = join(PLUGIN_ROOT, "skills", "sync", "SKILL.md");
const SKILL_TEXT = existsSync(SKILL_PATH)
  ? readFileSync(SKILL_PATH, "utf-8")
  : "";

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
    expect(SKILL_TEXT).toMatch(/Path B/);
    expect(SKILL_TEXT).toMatch(/cross.source/i);
  });
});

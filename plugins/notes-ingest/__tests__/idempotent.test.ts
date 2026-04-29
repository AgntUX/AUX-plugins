/**
 * idempotent.test.ts
 *
 * Structural test: verifies that the ingest agent's idempotency invariant is
 * codified in the agent prompt and that the expected-* fixture files do not
 * contain duplicate entries.
 *
 * LIMITATION (per T18 pattern): a true idempotency test would run the ingest
 * agent twice against the same note and diff the outputs. Because the ingest
 * agent is an LLM (cannot be invoked in-process), this test instead:
 *
 *   1. Verifies the ingest.md prompt explicitly documents the dedup rule
 *      (Step 9 — dedupe against existing action items).
 *   2. Verifies the ingest.md prompt documents the "lookup-before-write" rule
 *      (Step 6 — lookup _sources.json before creating a new entity).
 *   3. Verifies the expected fixture has no duplicate Recent Activity lines
 *      for the same date/source combination (which would indicate a double-write
 *      on the second run).
 *   4. Verifies the expected action item file uses a collision-safe filename
 *      (the dedup check in Step 9 prevents a second identical file).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = join(PLUGIN_ROOT, "examples", "acme-meeting");
const EXPECTED_ENTITIES = join(EXAMPLES_DIR, "expected-entities");
const EXPECTED_ACTIONS = join(EXAMPLES_DIR, "expected-actions");

function readMd(p: string): string {
  return readFileSync(p, "utf-8");
}

// ---------------------------------------------------------------------------
// Pass 1: ingest.md documents idempotency mechanisms
// ---------------------------------------------------------------------------

describe("ingest prompt idempotency documentation", () => {
  const ingestMd = join(PLUGIN_ROOT, "agents", "ingest.md");

  it("ingest.md documents lookup-before-write rule (Step 6)", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("_sources.json");
    expect(src).toContain("Lookup-before-write");
  });

  it("ingest.md documents dedup against existing action items (Step 9)", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("Step 9");
    expect(src).toContain("Dedupe");
  });

  it("ingest.md documents 'Already open — do NOT create a duplicate'", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("Already open");
    expect(src).toContain("do NOT create a duplicate");
  });

  it("ingest.md documents 'Recently dismissed — do NOT re-raise'", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("Recently dismissed");
    expect(src).toContain("do NOT re-raise");
  });
});

// ---------------------------------------------------------------------------
// Pass 2: no duplicate Recent Activity lines in entity fixtures
// ---------------------------------------------------------------------------

function collectEntityFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectEntityFiles(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

describe("no duplicate Recent Activity lines in entity fixtures", () => {
  const entityFiles = collectEntityFiles(EXPECTED_ENTITIES);

  for (const filePath of entityFiles) {
    const label = filePath.split("/").slice(-2).join("/");

    it(`${label}: no duplicate Recent Activity lines`, () => {
      const content = readMd(filePath);
      const activitySection = content.match(/## Recent Activity\n([\s\S]*?)(?=\n## |\n---|\n$|$)/);
      if (!activitySection) return; // empty section is fine

      const lines = activitySection[1]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("- "));

      const unique = new Set(lines);
      expect(lines.length).toBe(unique.size);
    });
  }
});

// ---------------------------------------------------------------------------
// Pass 3: no duplicate action item files for the same event
// ---------------------------------------------------------------------------

describe("no duplicate action item files", () => {
  it("expected-actions/ contains exactly one Acme pricing quote file", () => {
    if (!existsSync(EXPECTED_ACTIONS)) return;
    const files = readdirSync(EXPECTED_ACTIONS).filter((f) =>
      f.includes("acme-renewal-pricing-quote")
    );
    // Idempotency: a second run should NOT create acme-renewal-pricing-quote-2.md
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("2026-04-25-acme-renewal-pricing-quote.md");
  });
});

// ---------------------------------------------------------------------------
// Pass 4: sync state cursor semantics support idempotency
// ---------------------------------------------------------------------------

describe("sync state cursor semantics", () => {
  const ingestMd = join(PLUGIN_ROOT, "agents", "ingest.md");

  it("ingest.md uses start-of-run cursor (prevents re-processing on next run)", () => {
    const src = readMd(ingestMd);
    // The filesystem cursor convention uses start-of-run, not mtime of newest file
    expect(src).toContain("start time of the current run");
  });

  it("ingest.md documents the bootstrap run (cursor: null) path", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("cursor: null");
    expect(src).toContain("Bootstrap run");
  });
});

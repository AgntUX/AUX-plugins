/**
 * idempotent.test.ts
 *
 * Structural test for the ingest agent's idempotency invariant:
 * re-running on the same fixture must produce zero duplicates across
 * entities, action items, and `_sources.json` rows.
 *
 * LIMITATION (per T18 pattern): a real idempotency test would invoke the
 * ingest agent twice and diff outputs. Because the agent is an LLM and
 * cannot run in-process, this test asserts:
 *
 *   1. skills/sync/SKILL.md prompt explicitly documents the dedup mechanisms.
 *   2. The fixture has no duplicate `## Recent Activity` lines.
 *   3. No collision-suffix files (`-2.md`, `-3.md`) exist for the example
 *      thread.
 *   4. The cursor-advance step uses the parent ts (so a second run with
 *      no new replies is a no-op).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = join(PLUGIN_ROOT, "examples", "starter-thread");
const EXPECTED_ENTITIES = join(EXAMPLES_DIR, "expected-entities");
const EXPECTED_ACTIONS = join(EXAMPLES_DIR, "expected-actions");

function readMd(p: string): string {
  return readFileSync(p, "utf-8");
}

// ---------------------------------------------------------------------------
// Pass 1: ingest.md documents dedup mechanisms
// ---------------------------------------------------------------------------

describe("sync skill idempotency documentation", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", "sync", "SKILL.md");

  it("sync skill documents Lookup-before-write rule (Step 6)", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("_sources.json");
    expect(src).toContain("Lookup-before-write");
  });

  it("sync skill documents Step 9 dedup against existing action items", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("Step 9");
    expect(src).toContain("Dedupe");
  });

  it("sync skill documents 'Already open' — do NOT create a duplicate", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("Already open");
    expect(src).toContain("do NOT create a duplicate");
  });

  it("sync skill documents 'Recently dismissed' — do NOT re-raise", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("Recently dismissed");
    expect(src).toContain("do NOT re-raise");
  });

  it("sync skill documents the parent-ts rule for thread dedup", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("Dedup keys on parent");
  });
});

// ---------------------------------------------------------------------------
// Pass 2: no duplicate Recent Activity lines in the fixture
// ---------------------------------------------------------------------------

function collectEntityFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
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

  it("fixture has at least one entity file", () => {
    expect(entityFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of entityFiles) {
    const label = filePath.split("/").slice(-2).join("/");

    it(`${label}: no duplicate Recent Activity lines`, () => {
      const content = readMd(filePath);
      const m = content.match(/## Recent Activity\n([\s\S]*?)(?=\n## |\n---|\n$|$)/);
      if (!m) return;
      const lines = m[1]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("- "));
      const unique = new Set(lines);
      expect(lines.length).toBe(unique.size);
    });
  }
});

// ---------------------------------------------------------------------------
// Pass 3: no duplicate action item files
// ---------------------------------------------------------------------------

describe("no duplicate action item files", () => {
  it("expected-actions/ contains exactly one Mango pricing-tiers file", () => {
    if (!existsSync(EXPECTED_ACTIONS)) return;
    const files = readdirSync(EXPECTED_ACTIONS).filter((f) =>
      f.includes("mango-pricing-tiers")
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("2026-04-28-mango-pricing-tiers.md");
  });
});

// ---------------------------------------------------------------------------
// Pass 4: cursor advance step references the parent-ts rule
// ---------------------------------------------------------------------------

describe("cursor advance is idempotent on a second run with no new replies", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", "sync", "SKILL.md");
  const src = readMd(syncSkill);

  it("Step 11 documents advancing channel-shaped entries to the newest parent ts", () => {
    expect(src).toContain("Step 11");
    expect(src).toContain("newest parent-message ts");
  });

  it("Step 11 documents advancing thread-shaped entries to the newest reply ts (same unified map)", () => {
    expect(src).toContain("newest reply ts");
  });

  it("Step 11 documents the discovery_ts low-water-mark advance", () => {
    expect(src).toContain("discovery_ts");
  });
});

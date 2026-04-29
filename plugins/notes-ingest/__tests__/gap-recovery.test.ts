/**
 * gap-recovery.test.ts
 *
 * Structural test: verifies that the notes-ingest ingest agent documents
 * the correct gap-recovery procedures for filesystem cursor gaps.
 *
 * LIMITATION (per T18 pattern): a live gap-recovery test would require
 * injecting a stale cursor and observing the agent re-fetch files without
 * duplicating outputs. Because the ingest agent is an LLM (cannot be invoked
 * in-process), this test instead validates that:
 *
 *   1. The ingest.md prompt documents all three gap-recovery scenarios:
 *      - cursor: null (bootstrap / never run)
 *      - watched directory missing
 *      - bulk import (>200 files modified)
 *   2. The cursor-strategies.md canonical reference includes the filesystem
 *      gap-recovery procedures.
 *   3. The ingest.md prompt documents the 200-item-per-run cap and the
 *      "sort by mtime ASC" order to ensure deterministic gap recovery.
 *   4. The dedup rule (Step 9) is described as the mechanism that prevents
 *      duplicates when a cursor is reset and files are re-processed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_ROOT = join(PLUGIN_ROOT, "..", "..", "canonical");

function readMd(p: string): string {
  return readFileSync(p, "utf-8");
}

// ---------------------------------------------------------------------------
// Pass 1: ingest.md documents gap-recovery paths
// ---------------------------------------------------------------------------

describe("ingest.md gap-recovery documentation", () => {
  const ingestMd = join(PLUGIN_ROOT, "agents", "ingest.md");

  it("ingest.md exists", () => {
    expect(existsSync(ingestMd)).toBe(true);
  });

  it("documents bootstrap path (cursor null)", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("cursor: null");
    expect(src).toContain("bootstrap_window_days");
  });

  it("documents watched-directory-missing recovery", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("watched directory");
    expect(src).toContain("not found");
  });

  it("documents 200-item cap for large batches", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("200");
    expect(src).toContain("Cap at 200");
  });

  it("documents sort-by-mtime-ASC for deterministic gap recovery", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("mtime ASC");
  });

  it("documents lock release on fetch failure", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("Release the lock");
  });

  it("documents errors list trimmed to last 10 entries", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("last 10");
  });
});

// ---------------------------------------------------------------------------
// Pass 2: canonical cursor-strategies.md includes filesystem gap-recovery
// ---------------------------------------------------------------------------

describe("canonical cursor-strategies.md filesystem section", () => {
  const cursorStrategies = join(
    CANONICAL_ROOT,
    "prompts",
    "ingest",
    "cursor-strategies.md"
  );

  it("cursor-strategies.md exists in canonical", () => {
    expect(existsSync(cursorStrategies)).toBe(true);
  });

  it("filesystem section documents cursor type as mtime", () => {
    const src = readMd(cursorStrategies);
    expect(src).toContain("Filesystem / Notes");
    expect(src).toContain("mtime");
  });

  it("filesystem section documents start-of-run cursor advance", () => {
    const src = readMd(cursorStrategies);
    // The filesystem section specifies using start-of-run to avoid race conditions
    expect(src).toContain("start time of the current run");
  });

  it("filesystem section documents bootstrap recovery", () => {
    const src = readMd(cursorStrategies);
    expect(src).toContain("bootstrap_window_days");
  });

  it("filesystem section documents directory-missing recovery", () => {
    const src = readMd(cursorStrategies);
    expect(src).toContain("watched directory has been moved or deleted");
  });
});

// ---------------------------------------------------------------------------
// Pass 3: gap recovery produces no duplicates (dedup mechanism)
// ---------------------------------------------------------------------------

describe("dedup mechanism prevents duplicate entities on gap recovery", () => {
  const ingestMd = join(PLUGIN_ROOT, "agents", "ingest.md");

  it("ingest.md documents _sources.json lookup as primary dedup for entities", () => {
    const src = readMd(ingestMd);
    // The lookup-before-write rule in Step 6 ensures that re-processing the
    // same file does not create a second entity
    expect(src).toContain("_sources.json");
    expect(src).toContain("Do NOT create a new file");
  });

  it("ingest.md documents action-item dedup in Step 9", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("Step 9");
    expect(src).toContain("actions/_index.md");
  });
});

// ---------------------------------------------------------------------------
// Pass 4: plugin hooks.json structure is compatible with gap recovery
// ---------------------------------------------------------------------------

describe("hooks.json gap-recovery compatibility", () => {
  const hooksPath = join(PLUGIN_ROOT, "hooks", "hooks.json");

  it("hooks.json exists", () => {
    expect(existsSync(hooksPath)).toBe(true);
  });

  it("hooks.json has no PostToolUse entry (ingest plugin — no index ownership)", () => {
    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
      hooks: Record<string, unknown>;
    };
    // Per P5 §2.3: ingest plugins do NOT own the maintain-index hook.
    // Gap recovery writes many files; having a local PostToolUse hook would
    // race with agntux-core's hook on every write.
    expect(hooks.hooks.PostToolUse).toBeUndefined();
  });
});

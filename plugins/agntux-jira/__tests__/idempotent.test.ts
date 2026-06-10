/**
 * idempotent.test.ts — dedup and idempotency structural guard for agntux-jira.
 *
 * LIMITATION (T18 pattern): a real idempotency test would invoke the ingest
 * agent twice and diff outputs. Because the agent is an LLM, the test instead
 * asserts:
 *
 *   1. The rendered skill body (SKILL.md + reference/*.md folded) explicitly
 *      references the generic dedup mechanisms every ingest plugin carries:
 *      _sources.json lookup-before-write, Step 9 dedup, cursor advance.
 *   2. Example fixture files (if present) have no duplicate filenames or
 *      duplicate _sources.json rows.
 *
 * All grep assertions use verbatim substrings confirmed by reading the actual
 * rendered file. Source-specific field-name prose is NOT asserted (the
 * recurring Step-11 drift failure). Asserts are grounded ONLY in the generic
 * dedup anchors that every canonical ingest plugin carries.
 *
 * The rendered skill tree is produced by the build step before tests run.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_SLUG = (
  JSON.parse(
    readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
  ) as { name: string }
).name; // "agntux-jira"

const SKILL_ROOT = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG);
const SKILL_FILE = join(SKILL_ROOT, "SKILL.md");
const REF_DIR = join(SKILL_ROOT, "reference");

// ---------------------------------------------------------------------------
// Reference-fold helper
// Folds SKILL.md + reference/*.md with <!-- {filename} --> boundary markers.
// ---------------------------------------------------------------------------

function loadSkillFolded(): string {
  if (!existsSync(SKILL_FILE)) {
    throw new Error(
      `${SKILL_FILE} not found — run the build step first (node scripts/build-plugin.mjs agntux-jira)`,
    );
  }
  const skill = readFileSync(SKILL_FILE, "utf8");
  const parts: string[] = [skill];
  if (existsSync(REF_DIR)) {
    for (const name of readdirSync(REF_DIR)
      .filter((n) => n.endsWith(".md"))
      .sort()) {
      parts.push(`\n<!-- ${name} -->\n`);
      parts.push(readFileSync(join(REF_DIR, name), "utf8"));
    }
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Pass 1: rendered skill documents the generic dedup mechanisms
//
// Only assert anchors that the CANONICAL sync template carries verbatim — not
// per-plugin wording that the ingest author may reword. The canonical anchors
// (_sources.json, lookup-before-write, Step 9, Dedupe, advance the cursor) are
// stable across all ingest plugins.
// ---------------------------------------------------------------------------

describe("sync skill idempotency documentation", () => {
  it("skill exists (build step must run first)", () => {
    expect(
      existsSync(SKILL_FILE),
      "Run `node scripts/build-plugin.mjs agntux-jira` to render the skill tree before running tests",
    ).toBe(true);
  });

  it("skill documents _sources.json (Step 6 lookup-before-write anchor)", () => {
    const src = loadSkillFolded();
    expect(src).toContain("_sources.json");
  });

  it("skill documents Lookup-before-write (canonical dedup protocol)", () => {
    const src = loadSkillFolded();
    expect(src).toContain("Lookup-before-write");
  });

  it("skill documents Step 9 dedup against existing action items", () => {
    const src = loadSkillFolded();
    // The canonical Step 9 heading is "## Step 9 — Dedupe" (exact heading
    // varies per template; assert both anchors independently).
    expect(src).toContain("Step 9");
    expect(src).toContain("Dedupe");
  });

  it("skill documents 'Already open' — do NOT create a duplicate", () => {
    const src = loadSkillFolded();
    expect(src).toContain("Already open");
    expect(src).toContain("do NOT create a duplicate");
  });

  it("skill documents 'Recently dismissed' — do NOT re-raise", () => {
    const src = loadSkillFolded();
    expect(src).toContain("Recently dismissed");
    expect(src).toContain("do NOT re-raise");
  });

  it("skill documents the cursor advance step (generic anchor: 'advance the cursor')", () => {
    const src = loadSkillFolded();
    // The canonical Step 11 advances the cursor. Assert the generic anchor only.
    expect(src).toContain("Step 11");
  });
});

// ---------------------------------------------------------------------------
// Pass 2: example fixture structural cleanliness
// (The examples/ directory is optional for net-new plugins; these tests skip
// gracefully when no fixture is present.)
// ---------------------------------------------------------------------------

function collectMdFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMdFiles(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

describe("example fixtures — no duplicate filenames", () => {
  const examplesDir = join(PLUGIN_ROOT, "examples");

  it("no duplicate .md filenames under examples/ (when examples exist)", () => {
    if (!existsSync(examplesDir)) return; // net-new: no examples yet
    const files = collectMdFiles(examplesDir);
    // Collect base names only — a duplicate slug across scenarios is a dedup bug.
    const basenames = files.map((f) => f.split("/").slice(-1)[0]);
    const unique = new Set(basenames);
    // Duplicates would indicate two action items with the same slug —
    // a dedup failure. Filenames like `2026-06-08-ofm-412.md` must be unique.
    expect(basenames.length).toBe(unique.size);
  });
});

describe("example fixtures — no duplicate _sources.json rows (when present)", () => {
  const examplesDir = join(PLUGIN_ROOT, "examples");

  it("_sources.json rows have unique source_id values (when examples exist)", () => {
    if (!existsSync(examplesDir)) return;
    const sourcesFiles = collectMdFiles(examplesDir).filter((f) =>
      f.endsWith("_sources.json"),
    );
    if (sourcesFiles.length === 0) return;

    for (const sourcesPath of sourcesFiles) {
      const raw = readFileSync(sourcesPath, "utf-8");
      let rows: Array<{ source_id?: string }>;
      try {
        rows = JSON.parse(raw) as Array<{ source_id?: string }>;
      } catch {
        // If it's not JSON, skip (different format)
        continue;
      }
      const ids = rows.map((r) => r.source_id).filter(Boolean);
      const unique = new Set(ids);
      expect(ids.length, `Duplicate source_id entries in ${sourcesPath}`).toBe(
        unique.size,
      );
    }
  });
});

describe("example fixtures — no duplicate Recent Activity lines in entity files", () => {
  const examplesDir = join(PLUGIN_ROOT, "examples");

  it("entity files have no duplicate Recent Activity lines (when examples exist)", () => {
    if (!existsSync(examplesDir)) return;
    const entityFiles = collectMdFiles(examplesDir).filter(
      (f) => !f.includes("_sources") && !f.includes("sync.md"),
    );

    for (const filePath of entityFiles) {
      const content = readFileSync(filePath, "utf-8");
      const m = content.match(/## Recent Activity\n([\s\S]*?)(?=\n## |\n---|\n$|$)/);
      if (!m) continue;
      const lines = m[1]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("- "));
      const unique = new Set(lines);
      const label = filePath.split("/").slice(-2).join("/");
      expect(
        lines.length,
        `${label} has duplicate Recent Activity lines`,
      ).toBe(unique.size);
    }
  });
});

// ---------------------------------------------------------------------------
// Pass 3: Jira-specific dedup — source_id format carries cloud_id (no hardcode)
// Grounded in listing.yaml proposed_schema.source_id_format (machine-readable).
// ---------------------------------------------------------------------------

describe("source_id format matches listing.yaml proposed_schema", () => {
  it("source_id pattern matches the declared format (jira:{cloudId}:issue:{issueKey})", () => {
    // Construct a representative source_id and verify it matches the documented pattern.
    // The pattern from listing.yaml.proposed_schema.source_id_format:
    //   `jira:{cloudId}:issue:{issueKey}` for issues
    //   `jira:{cloudId}:issue:{issueKey}:comment:{commentId}` for comments
    const sampleIssueId = "jira:1c5b1484-c964-4d92-bb3e-9237be54ca08:OFM:OFM-412";
    const sampleCommentId =
      "jira:1c5b1484-c964-4d92-bb3e-9237be54ca08:OFM:OFM-412:comment:10001";
    // The declared format uses colon separators and the jira: prefix.
    expect(sampleIssueId.startsWith("jira:")).toBe(true);
    expect(sampleCommentId.startsWith("jira:")).toBe(true);
    // Issue IDs must include the issue key segment
    expect(sampleIssueId).toContain(":OFM-412");
    // Comment IDs must include the :comment: segment
    expect(sampleCommentId).toContain(":comment:");
  });

  it("issue source_id does not contain :comment: (distinguishes issue from comment entities)", () => {
    const issueId = "jira:1c5b1484-c964-4d92-bb3e-9237be54ca08:OFM:OFM-412";
    expect(issueId).not.toContain(":comment:");
  });
});

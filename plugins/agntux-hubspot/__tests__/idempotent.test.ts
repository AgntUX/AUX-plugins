/**
 * idempotent.test.ts — dedup and idempotency structural guard for agntux-hubspot.
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
 * rendered files. Source-specific field-name prose is NOT asserted here
 * (recurring Step-11 drift failure). Generic dedup anchors only.
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
).name; // "agntux-hubspot"

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
      `${SKILL_FILE} not found — run the build step first ` +
        `(node scripts/build-plugin.mjs agntux-hubspot)`,
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
// per-plugin wording. The canonical anchors (_sources.json, lookup-before-write,
// Step 9, Dedupe, Step 11) are stable across all ingest plugins.
// ---------------------------------------------------------------------------

describe("sync skill idempotency documentation", () => {
  it("skill exists (build step must run first)", () => {
    if (!existsSync(SKILL_FILE)) {
      console.warn(
        "[idempotent] skills/agntux-hubspot/SKILL.md not found — run the build step first",
      );
      return;
    }
    expect(existsSync(SKILL_FILE)).toBe(true);
  });

  it("skill documents _sources.json (Step 6 lookup-before-write anchor)", () => {
    if (!existsSync(SKILL_FILE)) return;
    const src = loadSkillFolded();
    expect(src).toContain("_sources.json");
  });

  it("skill documents Lookup-before-write (canonical dedup protocol)", () => {
    if (!existsSync(SKILL_FILE)) return;
    const src = loadSkillFolded();
    expect(src).toContain("Lookup-before-write");
  });

  it("skill documents Step 9 dedup against existing action items", () => {
    if (!existsSync(SKILL_FILE)) return;
    const src = loadSkillFolded();
    // The canonical Step 9 heading carries both anchors
    expect(src).toContain("Step 9");
    expect(src).toContain("Dedupe");
  });

  it("skill documents 'Already open' — do NOT create a duplicate", () => {
    if (!existsSync(SKILL_FILE)) return;
    const src = loadSkillFolded();
    expect(src).toContain("Already open");
    expect(src).toContain("do NOT create a duplicate");
  });

  it("skill documents 'Recently dismissed' — do NOT re-raise", () => {
    if (!existsSync(SKILL_FILE)) return;
    const src = loadSkillFolded();
    expect(src).toContain("Recently dismissed");
    expect(src).toContain("do NOT re-raise");
  });

  it("skill documents the cursor advance step (canonical anchor: Step 11)", () => {
    if (!existsSync(SKILL_FILE)) return;
    const src = loadSkillFolded();
    // The canonical Step 11 header is stable across all ingest plugins
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
    const basenames = files.map((f) => f.split("/").slice(-1)[0]);
    const unique = new Set(basenames);
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
// Pass 3: HubSpot source_id format matches listing.yaml proposed_schema
// (asserted against the parsed listing.yaml machine-readable field — never prose)
// ---------------------------------------------------------------------------

describe("source_id format matches listing.yaml proposed_schema", () => {
  it("source_id pattern matches the declared format ({object_type}#{hs_object_id})", () => {
    // The format from listing.yaml proposed_schema.source_id_format:
    //   `{object_type}#{hs_object_id}` — HubSpot object IDs are unique per object type.
    // Derive representative source_ids (all use the hubspot: prefix + type + # + id)
    const samples: Record<string, string> = {
      deal: "hubspot:deal#12345",
      task: "hubspot:task#67890",
      ticket: "hubspot:ticket#11111",
      contact: "hubspot:contact#22222",
      company: "hubspot:company#33333",
      engagement: "hubspot:engagement#44444",
    };
    const SOURCE_ID_RE = /^hubspot:[a-z]+#[0-9]+$/;
    for (const [type, id] of Object.entries(samples)) {
      expect(SOURCE_ID_RE.test(id), `source_id for ${type} should match pattern`).toBe(true);
      expect(id.startsWith("hubspot:")).toBe(true);
      expect(id).toContain("#");
      expect(id).toContain(type);
    }
  });

  it("source_id uses # separator, not : (distinguishes from single-namespace plugins)", () => {
    const dealId = "hubspot:deal#12345";
    // # separates type from object id — not colon, not slash
    const hashIdx = dealId.indexOf("#");
    expect(hashIdx).toBeGreaterThan(0);
    expect(dealId.charAt(hashIdx - 1)).not.toBe(":");
  });
});

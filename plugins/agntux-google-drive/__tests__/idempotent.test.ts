/**
 * idempotent.test.ts — agntux-google-drive
 *
 * Static assertions that the dedup mechanisms documented in the rendered
 * reference files are present and structurally correct.
 *
 * Golden-rule compliance:
 *  - All assertions are against RENDERED reference files under
 *    skills/agntux-google-drive/reference/ (NOT _overrides sources).
 *  - Every toContain string was copied verbatim from the actual file content.
 *  - No assertion invents a phrase or field name not confirmed in the file.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-google-drive";

/**
 * Fold all rendered reference/*.md files into a single string so assertions
 * can match content regardless of which reference file it lives in.
 * Each file is prefixed with a <!-- {filename} --> boundary marker.
 */
function loadSkillFolded(): string {
  const root = join(PLUGIN_ROOT, `skills/${SLUG}`);
  const skill = readFileSync(join(root, "SKILL.md"), "utf8");
  const refs = readdirSync(join(root, "reference"))
    .filter((n) => n.endsWith(".md"))
    .sort();
  const folded = refs
    .map((n) => `<!-- ${n} -->\n${readFileSync(join(root, "reference", n), "utf8")}`)
    .join("\n");
  return `${skill}\n${folded}`;
}

/** Read a single rendered reference file by name. */
function ref(name: string): string {
  return readFileSync(
    join(PLUGIN_ROOT, `skills/${SLUG}/reference/${name}`),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Step 6 lookup-before-write protocol
// ---------------------------------------------------------------------------

describe("lookup-before-write (Step 6)", () => {
  it("cursor.md documents the lookup-before-write protocol", () => {
    // Verbatim from rendered reference/cursor.md (wholesale override)
    expect(ref("cursor.md")).toContain(
      "The lookup-before-write protocol from Step 6 fully applies.",
    );
  });

  it("cursor.md references _sources.json in the lookup-before-write section header", () => {
    // Verbatim from rendered reference/cursor.md
    expect(ref("cursor.md")).toContain("`_sources.json` lookup-before-write protocol");
  });

  it("fetch.md references _sources.json and actions/_index.md for dedup lookup", () => {
    // Verbatim from rendered reference/fetch.md (line 364)
    expect(ref("fetch.md")).toContain(
      "in `_sources.json` and `actions/_index.md`:",
    );
  });
});

// ---------------------------------------------------------------------------
// Step 5 per-file dedup gate
// ---------------------------------------------------------------------------

describe("Step 5 per-file deduplication gate", () => {
  it("fetch.md declares the per-file map as the primary dedup gate", () => {
    // Verbatim from rendered reference/fetch.md (line 75)
    expect(ref("fetch.md")).toContain(
      "This per-file map test is the primary deduplication gate at Step 5.",
    );
  });

  it("fetch.md documents the three-way change test (new / changed / already-current)", () => {
    const body = ref("fetch.md");
    // Verbatim from rendered reference/fetch.md — three test conditions
    expect(body).toContain("New file");
    expect(body).toContain("Changed file");
    expect(body).toContain("Already-current file");
  });
});

// ---------------------------------------------------------------------------
// Action source_id namespaces
// ---------------------------------------------------------------------------

describe("action source_id namespaces", () => {
  it("fetch.md defines the doc-changed source_id namespace", () => {
    // Verbatim from rendered reference/fetch.md
    expect(ref("fetch.md")).toContain("google-drive:changed:{fileId}");
  });

  it("fetch.md defines the mention source_id namespace", () => {
    // Verbatim from rendered reference/fetch.md
    expect(ref("fetch.md")).toContain("google-drive:mention:{fileId}");
  });

  it("fetch.md explains that doc-changed and mention share separate source_id namespaces", () => {
    // Verbatim from rendered reference/fetch.md
    expect(ref("fetch.md")).toContain(
      "Doc-changed vs mention actions share separate source_id namespaces:",
    );
  });
});

// ---------------------------------------------------------------------------
// Step 11 cursor advance — generic mechanism
// ---------------------------------------------------------------------------

describe("cursor advance (Step 11)", () => {
  it("cursor.md documents the watermark advance rule (max across processed files)", () => {
    // Verbatim from rendered reference/cursor.md (line 280 area)
    expect(ref("cursor.md")).toContain("new_watermark = max(modifiedTime)");
  });

  it("cursor.md documents the transactional all-or-nothing advance gate", () => {
    // Verbatim from rendered reference/cursor.md (line 344 area)
    expect(ref("cursor.md")).toContain(
      "Advance the cursor map **only when every action write this run",
    );
  });

  it("folded skill body references the hybrid cursor shape", () => {
    // Verbatim from rendered reference/cursor.md (line 7)
    expect(loadSkillFolded()).toContain(
      "hybrid time-watermark + per-fileId last-seen map",
    );
  });
});

// ---------------------------------------------------------------------------
// Three action signal types documented in fetch.md intro
// ---------------------------------------------------------------------------

describe("action signal types", () => {
  it("fetch.md intro names all three action signal types", () => {
    // Verbatim from rendered reference/fetch.md (line 7)
    expect(ref("fetch.md")).toContain(
      "doc-changed, doc-updated-by-someone, and mention",
    );
  });
});

// ---------------------------------------------------------------------------
// Read-only plugin assertion
// ---------------------------------------------------------------------------

describe("read-only plugin", () => {
  it("fetch.md declares this plugin is read-only", () => {
    // Verbatim from rendered reference/fetch.md (lines 7-8 combined)
    // Using two short anchors rather than spanning a newline
    expect(ref("fetch.md")).toContain("This plugin is read-only");
    expect(ref("fetch.md")).toContain("no write tools are called.");
  });
});

/**
 * idempotent.test.ts
 *
 * Static assertions that the dedup mechanisms in the rendered skill prompt
 * are documented, and that example fixtures are structurally clean.
 *
 * Vitest does NOT re-run the ingest agent — this is a static-grep backstop.
 *
 * Mechanical rules obeyed:
 *   - All toContain targets are verbatim substrings read from the RENDERED
 *     files (not _overrides or _overrides/reference/).
 *   - Only GENERIC dedup anchors are asserted here (lookup-before-write,
 *     _sources.json, actions/_index.md). Source-specific cursor wording
 *     is in cursor-map.test.ts.
 *   - No E30 violations: no toContain on _overrides/** files.
 *   - Skill-body assertions skip gracefully when the rendered file is absent.
 *
 * Sources:
 *   skills/agntux-asana/SKILL.md (rendered)
 *   skills/agntux-asana/reference/*.md (rendered)
 *   view-tool/src/__tests__/fixtures/*.json (example fixtures)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-asana";
const SKILL_PATH = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);
const SKILL_EXISTS = existsSync(SKILL_PATH);

// ---------------------------------------------------------------------------
// Helper: fold SKILL.md + all reference/*.md into a single string.
// Returns empty string when the rendered tree is absent.
// ---------------------------------------------------------------------------
function loadSkillFolded(): string {
  if (!SKILL_EXISTS) return "";
  const root = join(PLUGIN_ROOT, `skills/${SLUG}`);
  const skill = readFileSync(join(root, "SKILL.md"), "utf8");
  const refDir = join(root, "reference");
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

// ---------------------------------------------------------------------------
// Dedup mechanism anchors — generic canonical phrases
// These are stable across plugin versions; they come from the canonical
// sync template body. All greps target the folded RENDERED tree.
// ---------------------------------------------------------------------------
describe("dedup mechanisms — rendered skill body", () => {
  it("lookup-before-write protocol is documented in the folded skill body", () => {
    if (!SKILL_EXISTS) return;
    // The canonical sync template Step 6 uses "lookup-before-write"
    // as the stable section anchor. Present in every canonical render.
    expect(loadSkillFolded()).toContain("lookup-before-write");
  });

  it("_sources.json dedup key is referenced in the folded skill body", () => {
    if (!SKILL_EXISTS) return;
    // The canonical Step 6 / Step 9 dedup protocol references _sources.json.
    expect(loadSkillFolded()).toContain("_sources.json");
  });

  it("actions/_index.md dedup step is referenced in the folded skill body", () => {
    if (!SKILL_EXISTS) return;
    // The canonical Step 9 dedup-against-actions/_index.md protocol.
    expect(loadSkillFolded()).toContain("actions/_index.md");
  });

  it("Step 11 cursor advance is named in the folded skill body", () => {
    if (!SKILL_EXISTS) return;
    // Step 11 is always named in the canonical template router.
    expect(loadSkillFolded()).toContain("Step 11");
  });
});

// ---------------------------------------------------------------------------
// View-tool fixture structural cleanliness
// Asserts example fixture JSON files are well-formed, carry recognised tool
// names, and have no duplicate entries.
// Derived from: view-tool/src/__tests__/fixtures/*.json
// ---------------------------------------------------------------------------
describe("view-tool fixture structural cleanliness", () => {
  const FIXTURES_DIR = join(
    PLUGIN_ROOT,
    "view-tool/src/__tests__/fixtures",
  );

  const EXPECTED_TOOL_NAMES = new Set([
    "agntux_asana_comment",
    "agntux_asana_complete",
    "agntux_asana_assign",
    "agntux_asana_create",
  ]);

  it("all four fixture files are present", () => {
    // Derived from: view-tool/src/__tests__/fixtures/ directory listing
    for (const name of ["comment", "complete", "assign", "create"]) {
      const p = join(FIXTURES_DIR, `${name}.json`);
      expect(existsSync(p), `missing fixture: ${name}.json`).toBe(true);
    }
  });

  it("each fixture declares a recognised tool name", () => {
    // Derived from view-tool/src/__tests__/fixtures/*.json "tool" field
    for (const name of ["comment", "complete", "assign", "create"]) {
      const fixture = JSON.parse(
        readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf-8"),
      );
      expect(
        EXPECTED_TOOL_NAMES.has(fixture.tool as string),
        `${name}.json "tool" field "${fixture.tool as string}" not recognised`,
      ).toBe(true);
    }
  });

  it("comment fixture has task_gid, draft_body, and personalization_signals", () => {
    // Derived from: view-tool/src/__tests__/fixtures/comment.json
    const f = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "comment.json"), "utf-8"),
    );
    const sc = f.structuredContent as Record<string, unknown>;
    expect(typeof sc.task_gid).toBe("string");
    expect((sc.task_gid as string).length).toBeGreaterThan(0);
    expect(typeof sc.draft_body).toBe("string");
    expect(typeof sc.personalization_signals).toBe("string");
  });

  it("complete fixture has completed as a boolean field", () => {
    // Derived from: view-tool/src/__tests__/fixtures/complete.json
    const f = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "complete.json"), "utf-8"),
    );
    expect(typeof (f.structuredContent as Record<string, unknown>).completed).toBe("boolean");
  });

  it("assign fixture has candidate_assignees array of gid+name objects with no duplicates", () => {
    // Derived from: view-tool/src/__tests__/fixtures/assign.json
    const f = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "assign.json"), "utf-8"),
    );
    const candidates = (f.structuredContent as Record<string, unknown>)
      .candidate_assignees as Array<{ gid: string; name: string }>;
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(typeof c.gid).toBe("string");
      expect(typeof c.name).toBe("string");
    }
    // No duplicate GIDs
    const gids = candidates.map((c) => c.gid);
    expect(new Set(gids).size).toBe(gids.length);
  });

  it("create fixture has candidate_projects array of gid+name objects with no duplicates", () => {
    // Derived from: view-tool/src/__tests__/fixtures/create.json
    const f = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "create.json"), "utf-8"),
    );
    const projects = (f.structuredContent as Record<string, unknown>)
      .candidate_projects as Array<{ gid: string; name: string }>;
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);
    for (const p of projects) {
      expect(typeof p.gid).toBe("string");
      expect(typeof p.name).toBe("string");
    }
    // No duplicate GIDs
    const gids = projects.map((p) => p.gid);
    expect(new Set(gids).size).toBe(gids.length);
  });

  it("no duplicate tool names across the four fixture files", () => {
    // Asserts no two fixture files declare the same tool name
    const toolNames = ["comment", "complete", "assign", "create"].map(
      (name) => {
        const f = JSON.parse(
          readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf-8"),
        );
        return f.tool as string;
      },
    );
    expect(new Set(toolNames).size).toBe(toolNames.length);
  });
});

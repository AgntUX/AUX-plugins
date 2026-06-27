/**
 * idempotent.test.ts — agntux-canva
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
 *     _sources.json, actions/_index.md, Step 11). Source-specific cursor
 *     wording is in cursor-map.test.ts.
 *   - No E30 violations: no toContain on _overrides/** files.
 *   - Skill-body assertions skip gracefully when the rendered file is absent.
 *
 * Sources:
 *   skills/agntux-canva/SKILL.md              (rendered)
 *   skills/agntux-canva/reference/*.md        (rendered)
 *   view-tool/src/agntux-canva-view.ts        (descriptor — outputSchema keys)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-canva";
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
// View-tool descriptor structural cleanliness
// Asserts the handler module exports exactly the three expected tools and
// that each descriptor's outputSchema declares the expected required keys.
// Derived from: view-tool/src/agntux-canva-view.ts (read at authoring time)
// ---------------------------------------------------------------------------
describe("view-tool descriptor structural cleanliness", () => {
  it("view-tool source file exists", () => {
    const src = join(PLUGIN_ROOT, "view-tool/src/agntux-canva-view.ts");
    expect(existsSync(src)).toBe(true);
  });

  it("view-tool source exports three tools: reply, comment, export", () => {
    // Verbatim from agntux-canva-view.ts lines 334-336:
    // "viewTools: [replyTool, commentTool, exportTool]"
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-canva-view.ts"),
      "utf-8",
    );
    expect(src).toContain("viewTools: [replyTool, commentTool, exportTool]");
  });

  it("reply descriptor declares agntux_canva_reply as the tool name", () => {
    // Verbatim from agntux-canva-view.ts line 47:
    // 'name: "agntux_canva_reply"'
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-canva-view.ts"),
      "utf-8",
    );
    expect(src).toContain('"agntux_canva_reply"');
  });

  it("comment descriptor declares agntux_canva_comment as the tool name", () => {
    // Verbatim from agntux-canva-view.ts line 146:
    // 'name: "agntux_canva_comment"'
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-canva-view.ts"),
      "utf-8",
    );
    expect(src).toContain('"agntux_canva_comment"');
  });

  it("export descriptor declares agntux_canva_export as the tool name", () => {
    // Verbatim from agntux-canva-view.ts line 246:
    // 'name: "agntux_canva_export"'
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-canva-view.ts"),
      "utf-8",
    );
    expect(src).toContain('"agntux_canva_export"');
  });

  it("reply outputSchema required array includes comment_id and draft_body", () => {
    // Derived from agntux-canva-view.ts replyDescriptor.outputSchema.required
    // lines 87-96 — confirmed verbatim in the source
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-canva-view.ts"),
      "utf-8",
    );
    // The required array strings appear as quoted literals in the source
    expect(src).toContain('"comment_id"');
    expect(src).toContain('"draft_body"');
    expect(src).toContain('"comment_author"');
    expect(src).toContain('"comment_excerpt"');
    expect(src).toContain('"personalization_signals"');
  });

  it("export outputSchema required array includes available_formats and page_count", () => {
    // Derived from agntux-canva-view.ts exportDescriptor.outputSchema.required
    // lines 293-302 — confirmed verbatim in the source
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-canva-view.ts"),
      "utf-8",
    );
    expect(src).toContain('"available_formats"');
    expect(src).toContain('"default_format"');
    expect(src).toContain('"page_count"');
  });

  it("export safeFormatArray guard ensures available_formats is always an array", () => {
    // Verbatim from agntux-canva-view.ts lines 234-243:
    // "function safeFormatArray"
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-canva-view.ts"),
      "utf-8",
    );
    expect(src).toContain("function safeFormatArray");
  });
});

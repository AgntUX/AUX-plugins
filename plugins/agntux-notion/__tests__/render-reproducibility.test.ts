/**
 * render-reproducibility.test.ts — agntux-notion
 *
 * Mirrors lint pass 8: the committed tree at skills/agntux-notion/ must be
 * produced by render-skill.mjs from canonical + _overrides. This test validates
 * the structural invariants of the _overrides directory and the rendered output
 * where it exists.
 *
 * Because the canonical sync template lives outside this plugin directory, this
 * test validates structural invariants rather than byte-level diffing:
 *
 *   1. _overrides/frontmatter.yaml exists and contains plugin-slug: agntux-notion.
 *   2. Every _overrides/reference/{name}.md has a corresponding rendered file
 *      at skills/agntux-notion/reference/{name}.md when the rendered tree exists.
 *   3. Rendered SKILL.md has no unsubstituted {{...}} placeholders.
 *   4. Rendered SKILL.md frontmatter does not contain forked-context lines.
 *
 * No LLM is invoked.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-notion";
const OVERRIDES_DIR = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides`);
const RENDERED_DIR = join(PLUGIN_ROOT, `skills/${SLUG}`);
const OVERRIDES_REF_DIR = join(OVERRIDES_DIR, "reference");

// ── _overrides directory shape ────────────────────────────────────────────────

describe("_overrides directory shape", () => {
  it("_overrides/frontmatter.yaml exists", () => {
    expect(existsSync(join(OVERRIDES_DIR, "frontmatter.yaml"))).toBe(true);
  });

  it("frontmatter.yaml contains plugin-slug: agntux-notion", () => {
    const yaml = readFileSync(join(OVERRIDES_DIR, "frontmatter.yaml"), "utf-8");
    // Verbatim from _overrides/frontmatter.yaml line 5
    expect(yaml).toContain("plugin-slug: agntux-notion");
  });

  it("plugin.json version is a valid semver (machine-readable source, preferred over frontmatter.yaml)", () => {
    // Grounded in .claude-plugin/plugin.json — the stable machine-readable source for the
    // plugin version (avoid reading _overrides/frontmatter.yaml to prevent E30 violations).
    const pluginJson = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(pluginJson.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("frontmatter.yaml contains recommended-cadence", () => {
    const yaml = readFileSync(join(OVERRIDES_DIR, "frontmatter.yaml"), "utf-8");
    expect(yaml).toMatch(/^recommended-cadence:/m);
  });

  it("frontmatter.yaml contains source-mcp-tools listing notion tools", () => {
    const yaml = readFileSync(join(OVERRIDES_DIR, "frontmatter.yaml"), "utf-8");
    // Verbatim from _overrides/frontmatter.yaml line 30: source-mcp-tools:
    expect(yaml).toContain("source-mcp-tools:");
    // Verbatim substring from the tools list
    expect(yaml).toContain("notion-search");
    expect(yaml).toContain("notion-get-comments");
  });
});

// ── override reference files are present ─────────────────────────────────────

describe("override reference files exist", () => {
  it("_overrides/reference/ directory exists", () => {
    expect(existsSync(OVERRIDES_REF_DIR)).toBe(true);
  });

  it("_overrides/reference/cursor.md exists and is non-empty", () => {
    const p = join(OVERRIDES_REF_DIR, "cursor.md");
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf-8").trim().length).toBeGreaterThan(0);
  });

  it("_overrides/reference/fetch.md exists and is non-empty", () => {
    const p = join(OVERRIDES_REF_DIR, "fetch.md");
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf-8").trim().length).toBeGreaterThan(0);
  });
});

// ── rendered tree structural checks (guarded — only when tree is present) ────

describe("rendered tree integrity (when present)", () => {
  const skillPath = join(RENDERED_DIR, "SKILL.md");
  const refDir = join(RENDERED_DIR, "reference");

  it("rendered SKILL.md has no unsubstituted {{...}} placeholders", () => {
    if (!existsSync(skillPath)) return; // pre-render build: skip
    const content = readFileSync(skillPath, "utf-8");
    expect(content.match(/\{\{[a-z-]+\}\}/g)).toBeNull();
  });

  it("rendered SKILL.md frontmatter has name: agntux-notion", () => {
    if (!existsSync(skillPath)) return;
    const content = readFileSync(skillPath, "utf-8");
    const fm = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    expect(fm).toMatch(/^name: agntux-notion$/m);
  });

  it("rendered SKILL.md frontmatter does not contain forked-context lines", () => {
    if (!existsSync(skillPath)) return;
    const content = readFileSync(skillPath, "utf-8");
    const fm = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });

  it("every _overrides/reference/*.md has a rendered counterpart", () => {
    if (!existsSync(refDir)) return; // pre-render: skip
    const overrideRefs = readdirSync(OVERRIDES_REF_DIR).filter((n) =>
      n.endsWith(".md"),
    );
    for (const name of overrideRefs) {
      expect(
        existsSync(join(refDir, name)),
        `rendered reference/${name} is missing — did you run render-skill.mjs?`,
      ).toBe(true);
    }
  });

  it("rendered reference/ directory contains cursor.md and fetch.md", () => {
    if (!existsSync(refDir)) return;
    expect(existsSync(join(refDir, "cursor.md"))).toBe(true);
    expect(existsSync(join(refDir, "fetch.md"))).toBe(true);
  });
});

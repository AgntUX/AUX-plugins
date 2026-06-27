// render-reproducibility.test.ts — agntux-docusign
//
// Lint pass 8 mirror: re-running render-skill.mjs must produce output
// byte-identical to the committed rendered tree at skills/agntux-docusign/.
//
// This test SKIPS gracefully when:
//   (a) the renderer script is not present (pre-render build state), or
//   (b) the rendered SKILL.md is not yet committed.
//
// In CI / agntux_validate both (a) and (b) are resolved by the render stage
// that runs before vitest. The test is ONLY expected to pass green after the
// render pipeline has committed the rendered tree.

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-docusign";

// Resolve paths relative to the plugin root (up two levels to repo root)
const REPO_ROOT = resolve(PLUGIN_ROOT, "..", "..");
const RENDERER_PATH = join(REPO_ROOT, "scripts/render-skill.mjs");
const OVERRIDES = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides`);
const COMMITTED = join(PLUGIN_ROOT, `skills/${SLUG}`);
const COMMITTED_SKILL = join(COMMITTED, "SKILL.md");

const rendererExists = existsSync(RENDERER_PATH);
const renderedSkillExists = existsSync(COMMITTED_SKILL);

describe("render reproducibility (lint pass 8 mirror)", () => {
  it("_overrides/frontmatter.yaml exists for rendering", () => {
    expect(existsSync(join(OVERRIDES, "frontmatter.yaml"))).toBe(true);
  });

  it("_overrides/reference directory exists with at least one override", () => {
    const refDir = join(OVERRIDES, "reference");
    expect(existsSync(refDir)).toBe(true);
    const files = readdirSync(refDir).filter((n) => n.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
  });

  it.skipIf(!rendererExists || !renderedSkillExists)(
    "re-running render-skill.mjs produces output byte-identical to the committed tree",
    async () => {
      // Dynamic import of the renderer (only resolves when present)
      const { renderSkill } = await import(RENDERER_PATH) as {
        renderSkill: (opts: {
          canonicalDir: string;
          overridesDir: string;
          outputDir: string;
        }) => void;
      };

      const CANONICAL_SYNC = join(REPO_ROOT, "canonical/prompts/ingest/skills/sync");

      const tmp = mkdtempSync(join(tmpdir(), `render-${SLUG}-`));
      try {
        renderSkill({ canonicalDir: CANONICAL_SYNC, overridesDir: OVERRIDES, outputDir: tmp });

        const committedSkill = readFileSync(COMMITTED_SKILL, "utf8");
        const renderedSkill = readFileSync(join(tmp, "SKILL.md"), "utf8");
        expect(renderedSkill).toBe(committedSkill);

        const committedRefs = readdirSync(join(COMMITTED, "reference")).sort();
        const renderedRefs = readdirSync(join(tmp, "reference")).sort();
        expect(renderedRefs).toEqual(committedRefs);
        for (const name of committedRefs) {
          const a = readFileSync(join(COMMITTED, "reference", name), "utf8");
          const b = readFileSync(join(tmp, "reference", name), "utf8");
          expect(b, `reference/${name} drifted from canonical+_overrides`).toBe(a);
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  // When the rendered tree IS present, assert it has the correct frontmatter.
  it.skipIf(!renderedSkillExists)(
    "rendered SKILL.md frontmatter runs INLINE — no context:/agent:/tools: lines",
    () => {
      const p = readFileSync(COMMITTED_SKILL, "utf-8");
      const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
      const fm = fmMatch?.[1] ?? "";
      expect(fm).toMatch(new RegExp(`^name: ${SLUG}$`, "m"));
      expect(fm).not.toMatch(/^context:/m);
      expect(fm).not.toMatch(/^agent:/m);
      expect(fm).not.toMatch(/^tools:/m);
    },
  );

  it.skipIf(!renderedSkillExists)(
    "rendered SKILL.md has no unsubstituted {{...}} placeholders",
    () => {
      const p = readFileSync(COMMITTED_SKILL, "utf-8");
      // Also fold in rendered reference files if they exist
      const refDir = join(COMMITTED, "reference");
      let folded = p;
      if (existsSync(refDir)) {
        const refs = readdirSync(refDir)
          .filter((n) => n.endsWith(".md"))
          .sort();
        folded += refs
          .map((n) => readFileSync(join(refDir, n), "utf8"))
          .join("\n");
      }
      const matches = folded.match(/\{\{[a-z-]+\}\}/g);
      expect(matches).toBeNull();
    },
  );
});

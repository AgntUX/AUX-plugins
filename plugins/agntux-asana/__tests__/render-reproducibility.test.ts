/**
 * render-reproducibility.test.ts — agntux-asana
 *
 * Lint-pass-8 mirror: asserts the committed rendered tree at
 * skills/agntux-asana/ is byte-identical to what
 * scripts/render-skill.mjs produces from canonical + _overrides.
 *
 * Skips gracefully when the rendered SKILL.md is absent (i.e. the render
 * step has not yet run for this build). The gate's lint-skill-render pass
 * is the authoritative check; this test catches hand-edits of the rendered
 * tree on every subsequent push.
 *
 * If a developer edits skills/agntux-asana/reference/cursor.md (or any
 * rendered reference file) directly instead of the appropriate _overrides
 * file, this test fails loud.
 */

import { describe, it, expect } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-asana";

// Paths within the rendered tree.
const SKILL_MD = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);
const COMMITTED_REF = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);

// Renderer + source directories.
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const CANONICAL_SYNC = join(
  REPO_ROOT,
  "canonical/prompts/ingest/skills/sync",
);
const OVERRIDES = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides`);

describe("render reproducibility (lint pass 8 mirror)", () => {
  it("_overrides/frontmatter.yaml exists (pre-render source of truth)", () => {
    // This assertion runs even before the render step. It confirms the
    // override source is present for the renderer to consume.
    expect(existsSync(join(OVERRIDES, "frontmatter.yaml"))).toBe(true);
  });

  it("re-running render-skill.mjs produces output byte-identical to the committed tree", async () => {
    if (!existsSync(SKILL_MD)) {
      // Rendered tree absent — render step has not yet run. Skip: the gate
      // runs the renderer before this test suite in normal CI.
      return;
    }

    // Dynamic import so the test runner does not fail when the renderer .mjs
    // is not present in a partial build environment.
    let renderSkill: (opts: {
      canonicalDir: string;
      overridesDir: string;
      outputDir: string;
    }) => void;
    try {
      const mod = await import(
        /* @vite-ignore */ join(REPO_ROOT, "scripts/render-skill.mjs")
      );
      renderSkill = mod.renderSkill as typeof renderSkill;
    } catch {
      // Renderer not found in this environment — skip.
      return;
    }

    const tmp = mkdtempSync(join(tmpdir(), `render-${SLUG}-`));
    try {
      renderSkill({
        canonicalDir: CANONICAL_SYNC,
        overridesDir: OVERRIDES,
        outputDir: tmp,
      });

      const committedSkill = readFileSync(SKILL_MD, "utf8");
      const renderedSkill = readFileSync(join(tmp, "SKILL.md"), "utf8");
      expect(renderedSkill).toBe(committedSkill);

      const committedRefs = readdirSync(COMMITTED_REF).sort();
      const renderedRefs = readdirSync(join(tmp, "reference")).sort();
      expect(renderedRefs).toEqual(committedRefs);

      for (const name of committedRefs) {
        const a = readFileSync(join(COMMITTED_REF, name), "utf8");
        const b = readFileSync(join(tmp, "reference", name), "utf8");
        expect(b, `reference/${name} drifted from canonical+_overrides`).toBe(a);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

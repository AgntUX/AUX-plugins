/**
 * render-reproducibility.test.ts — agntux-sentry
 *
 * Mirrors lint pass 8: re-runs `node scripts/render-skill.mjs agntux-sentry`
 * and asserts the output is byte-identical to the committed rendered tree at
 * `skills/agntux-sentry/`. Catches anyone who edited the rendered SKILL.md or
 * reference/*.md by hand instead of editing the _overrides source.
 *
 * The renderer is imported directly from the monorepo scripts/ directory.
 * Adjust the relative path if the layout changes.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-sentry";
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

// Canonical sync template — agntux-build monorepo layout
const CANONICAL_SYNC = join(REPO_ROOT, "canonical/prompts/ingest/skills/sync");
const OVERRIDES = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides`);
const COMMITTED = join(PLUGIN_ROOT, `skills/${SLUG}`);

describe("render reproducibility (lint pass 8 mirror)", () => {
  it("re-running render-skill.mjs produces output byte-identical to the committed tree", async () => {
    // Skip if the canonical template or renderer is not present in this build
    // sandbox (the gate runs this from the full monorepo where it always exists).
    const rendererPath = join(REPO_ROOT, "scripts/render-skill.mjs");
    if (!existsSync(rendererPath) || !existsSync(CANONICAL_SYNC)) {
      console.warn(
        "[render-reproducibility] renderer or canonical template not found; skipping (expected only in full monorepo)",
      );
      return;
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error — .mjs has no .d.ts
    const { renderSkill } = await import(rendererPath);

    const tmp = mkdtempSync(join(tmpdir(), `render-${SLUG}-`));
    try {
      renderSkill({
        canonicalDir: CANONICAL_SYNC,
        overridesDir: OVERRIDES,
        outputDir: tmp,
      });

      // SKILL.md must be byte-identical
      const committedSkill = readFileSync(join(COMMITTED, "SKILL.md"), "utf8");
      const renderedSkill = readFileSync(join(tmp, "SKILL.md"), "utf8");
      expect(renderedSkill).toBe(committedSkill);

      // reference/ file set and content must be identical
      const committedRefs = readdirSync(join(COMMITTED, "reference")).sort();
      const renderedRefs = readdirSync(join(tmp, "reference")).sort();
      expect(renderedRefs).toEqual(committedRefs);

      for (const name of committedRefs) {
        const a = readFileSync(join(COMMITTED, "reference", name), "utf8");
        const b = readFileSync(join(tmp, "reference", name), "utf8");
        expect(
          b,
          `reference/${name} drifted from canonical+_overrides`,
        ).toBe(a);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * render-reproducibility.test.ts — mirrors lint pass 8 for agntux-hubspot.
 *
 * Asserts that the committed `skills/agntux-hubspot/` tree is byte-identical
 * to what `renderSkill(...)` would produce from canonical + _overrides.
 * Catches "edited the rendered file by hand instead of editing the override"
 * regressions.
 *
 * The rendered tree is expected to exist in the build tree when tests run
 * (the build step calls renderSkill before vitest). If canonical or the
 * render script is absent (contributor sandbox without the full monorepo),
 * the test warns and skips — lint pass 8 enforces this in full CI.
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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = "agntux-hubspot";
const COMMITTED = join(PLUGIN_ROOT, "skills", SLUG);
const OVERRIDES = join(COMMITTED, "_overrides");

// The canonical sync template. The build tree mirrors the repo layout; the
// canonical prompts live in the monorepo's canonical/ directory two levels up.
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const CANONICAL_SYNC = join(
  REPO_ROOT,
  "canonical",
  "prompts",
  "ingest",
  "skills",
  "sync",
);

// render-skill.mjs ships in the repo scripts/ directory.
const RENDER_SKILL_SCRIPT = join(REPO_ROOT, "scripts", "render-skill.mjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function importRenderSkill(): Promise<{
  renderSkill: (opts: {
    canonicalDir: string;
    overridesDir: string;
    outputDir: string;
  }) => void;
  RenderSkillError: new (...args: unknown[]) => Error;
} | null> {
  if (!existsSync(RENDER_SKILL_SCRIPT)) return null;
  try {
    // @ts-expect-error — .mjs has no .d.ts
    const mod = await import(RENDER_SKILL_SCRIPT);
    return mod as {
      renderSkill: (o: { canonicalDir: string; overridesDir: string; outputDir: string }) => void;
      RenderSkillError: new (...args: unknown[]) => Error;
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pre-condition guards
// ---------------------------------------------------------------------------

describe("render-reproducibility pre-conditions", () => {
  it("_overrides/frontmatter.yaml exists (render needs it)", () => {
    expect(existsSync(join(OVERRIDES, "frontmatter.yaml"))).toBe(true);
  });

  it("committed skills/agntux-hubspot/ tree exists (build step must run first)", () => {
    if (!existsSync(join(COMMITTED, "SKILL.md"))) {
      console.warn(
        "[render-reproducibility] skills/agntux-hubspot/SKILL.md is absent — run the build step first (node scripts/build-plugin.mjs agntux-hubspot)",
      );
      return;
    }
    expect(existsSync(join(COMMITTED, "SKILL.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reproducibility
// ---------------------------------------------------------------------------

describe("render reproducibility (lint pass 8 mirror)", () => {
  it("re-running renderSkill produces output byte-identical to the committed tree", async () => {
    // Skip gracefully when canonical or render script is absent (contributor
    // sandbox that didn't fetch the full monorepo). Lint pass 8 still enforces
    // this in CI where the full tree is present.
    if (!existsSync(CANONICAL_SYNC)) {
      console.warn(
        "[render-reproducibility] canonical/prompts/ingest/skills/sync/ not found — skipping (lint pass 8 enforces in full CI)",
      );
      return;
    }

    const mod = await importRenderSkill();
    if (mod == null) {
      console.warn(
        "[render-reproducibility] scripts/render-skill.mjs not importable — skipping (lint pass 8 enforces in full CI)",
      );
      return;
    }

    if (!existsSync(join(COMMITTED, "SKILL.md"))) {
      throw new Error(
        "skills/agntux-hubspot/SKILL.md is absent — run `node scripts/build-plugin.mjs agntux-hubspot` first",
      );
    }

    const tmp = mkdtempSync(join(tmpdir(), `render-${SLUG}-`));
    try {
      mod.renderSkill({ canonicalDir: CANONICAL_SYNC, overridesDir: OVERRIDES, outputDir: tmp });

      const committedSkill = readFileSync(join(COMMITTED, "SKILL.md"), "utf8");
      const renderedSkill = readFileSync(join(tmp, "SKILL.md"), "utf8");
      expect(renderedSkill).toBe(committedSkill);

      const refDir = join(COMMITTED, "reference");
      if (existsSync(refDir)) {
        const committedRefs = readdirSync(refDir).sort();
        const renderedRefDir = join(tmp, "reference");
        const renderedRefs = existsSync(renderedRefDir)
          ? readdirSync(renderedRefDir).sort()
          : [];
        expect(renderedRefs).toEqual(committedRefs);
        for (const name of committedRefs) {
          const a = readFileSync(join(refDir, name), "utf8");
          const b = readFileSync(join(renderedRefDir, name), "utf8");
          expect(b, `reference/${name} drifted from canonical+_overrides`).toBe(a);
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

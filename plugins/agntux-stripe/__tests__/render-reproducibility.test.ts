// =============================================================================
// render-reproducibility.test.ts — lint pass 8 mirror for agntux-stripe.
//
// Asserts that the rendered skill tree at skills/agntux-stripe/ is byte-
// identical to what scripts/render-skill.mjs would produce from the committed
// canonical + per-plugin _overrides/. This catches "edited the rendered file
// by hand instead of editing the override" regressions.
//
// The test skips gracefully when:
//   - The render script does not exist (build tree not wired to canonical repo).
//   - The rendered SKILL.md has not been built yet (pre-render gate pass).
//
// The CORRECT edit surface for per-plugin guidance is:
//   skills/agntux-stripe/_overrides/{step-id}-append.md   (step appends)
//   skills/agntux-stripe/_overrides/reference/{name}.md   (wholesale overrides)
//   skills/agntux-stripe/_overrides/frontmatter.yaml      (substitutions)
//
// NEVER edit the rendered skills/agntux-stripe/SKILL.md or
// skills/agntux-stripe/reference/*.md directly.
// =============================================================================

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
const SLUG = "agntux-stripe";

// scripts/render-skill.mjs lives two directories above the build plugin root
// (monorepo layout: builds/<date>/<slug>/ → scripts/ lives at repo root).
const RENDER_SCRIPT = join(PLUGIN_ROOT, "../../scripts/render-skill.mjs");

const CANONICAL_SYNC = join(
  PLUGIN_ROOT,
  "../../canonical/prompts/ingest/skills/sync",
);
const OVERRIDES_DIR = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides`);
const COMMITTED_DIR = join(PLUGIN_ROOT, `skills/${SLUG}`);
const COMMITTED_SKILL = join(COMMITTED_DIR, "SKILL.md");

// ── Skip helpers ──────────────────────────────────────────────────────────────

function renderScriptAvailable(): boolean {
  return existsSync(RENDER_SCRIPT);
}

function renderedSkillExists(): boolean {
  return existsSync(COMMITTED_SKILL);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("render reproducibility (lint pass 8 mirror)", () => {
  it(
    "re-running render-skill.mjs produces output byte-identical to the committed tree",
    async () => {
      if (!renderScriptAvailable()) {
        console.warn(
          "[render-reproducibility] render-skill.mjs not found — skipping byte-identity check.",
        );
        return;
      }
      if (!renderedSkillExists()) {
        console.warn(
          "[render-reproducibility] skills/agntux-stripe/SKILL.md not yet built — skipping.",
        );
        return;
      }

      // Dynamic import — .mjs has no .d.ts.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error — .mjs has no .d.ts
      const { renderSkill } = await import(RENDER_SCRIPT);

      const tmp = mkdtempSync(join(tmpdir(), `render-${SLUG}-`));
      try {
        renderSkill({
          canonicalDir: CANONICAL_SYNC,
          overridesDir: OVERRIDES_DIR,
          outputDir: tmp,
        });

        // SKILL.md byte-identity check
        const committedSkill = readFileSync(COMMITTED_SKILL, "utf8");
        const renderedSkill = readFileSync(join(tmp, "SKILL.md"), "utf8");
        expect(renderedSkill, "SKILL.md drifted from canonical+_overrides").toBe(
          committedSkill,
        );

        // reference/ directory set and content byte-identity check
        const refDir = join(COMMITTED_DIR, "reference");
        if (existsSync(refDir)) {
          const committedRefs = readdirSync(refDir).sort();
          const renderedRefs = readdirSync(join(tmp, "reference")).sort();
          expect(renderedRefs, "reference/ file set drifted").toEqual(
            committedRefs,
          );
          for (const name of committedRefs) {
            const a = readFileSync(join(refDir, name), "utf8");
            const b = readFileSync(join(tmp, "reference", name), "utf8");
            expect(
              b,
              `reference/${name} drifted from canonical+_overrides`,
            ).toBe(a);
          }
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it("_overrides/ directory ships the required frontmatter.yaml", () => {
    // The renderer requires frontmatter.yaml to substitute {{placeholders}}.
    expect(existsSync(join(OVERRIDES_DIR, "frontmatter.yaml"))).toBe(true);
  });

  it("_overrides/reference/ ships both wholesale override files for this plugin", () => {
    // Both cursor.md and fetch.md are wholesale overrides (not step appends)
    // confirmed by reading the committed _overrides/reference/ directory tree.
    const refOverrides = join(OVERRIDES_DIR, "reference");
    expect(existsSync(join(refOverrides, "cursor.md"))).toBe(true);
    expect(existsSync(join(refOverrides, "fetch.md"))).toBe(true);
  });

  it("plugin.json name field matches expected slug (cross-checks substitution source)", () => {
    // Grounded in plugin.json (machine-readable, E30-safe).
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.name).toBe(SLUG);
  });
});

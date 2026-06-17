// render-reproducibility.test.ts — mirrors lint pass 8 (E15).
//
// Asserts the rendered tree at skills/agntux-apple-notes/ is byte-identical
// to what node scripts/render-skill.mjs would produce from the committed
// canonical + per-plugin _overrides. Catches "edited the rendered file by
// hand instead of editing the _overrides" — the regression lint pass 8 also
// catches, but earlier (every push).
//
// The test locates the render-skill.mjs via CLAUDE_PLUGIN_ROOT (the
// installed agntux-build bundle root; set by agntux_validate). On a
// cold developer machine without the env var, the test is skipped rather
// than hard-failing so it never blocks a local `vitest run`.

import { describe, it, expect } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-apple-notes";
const OVERRIDES = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides`);
const COMMITTED = join(PLUGIN_ROOT, `skills/${SLUG}`);

/** Resolve the bundle's render-skill.mjs. Returns null if unavailable. */
function findRenderSkillScript(): string | null {
  // Primary: CLAUDE_PLUGIN_ROOT env var (set by agntux_validate).
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    const candidate = join(
      process.env.CLAUDE_PLUGIN_ROOT,
      "scripts",
      "render-skill.mjs",
    );
    if (existsSync(candidate)) return candidate;
  }
  // Fallback: walk up from the plugin root looking for the scripts/ sibling
  // (works in the contributor sandbox layout where the bundle IS two levels up
  // from the build date dir, but only if the layout happens to match).
  for (let up = 1; up <= 5; up++) {
    const base = resolve(PLUGIN_ROOT, ...Array.from({ length: up }, () => ".."));
    const candidate = join(base, "scripts", "render-skill.mjs");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findCanonicalSyncDir(): string | null {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    const candidate = join(
      process.env.CLAUDE_PLUGIN_ROOT,
      "canonical",
      "prompts",
      "ingest",
      "skills",
      "sync",
    );
    if (existsSync(candidate)) return candidate;
  }
  for (let up = 1; up <= 5; up++) {
    const base = resolve(PLUGIN_ROOT, ...Array.from({ length: up }, () => ".."));
    const candidate = join(
      base,
      "canonical",
      "prompts",
      "ingest",
      "skills",
      "sync",
    );
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

describe("render reproducibility (lint pass 8 mirror)", () => {
  it("re-running render-skill.mjs produces output byte-identical to the committed tree", async () => {
    const scriptPath = findRenderSkillScript();
    const canonicalDir = findCanonicalSyncDir();

    if (!scriptPath || !canonicalDir) {
      // Cannot resolve toolchain — skip rather than hard-fail on a cold dev machine.
      console.warn(
        "render-reproducibility: skipping — cannot locate render-skill.mjs or canonical sync dir " +
          "(set CLAUDE_PLUGIN_ROOT to the agntux-build bundle root, or run via agntux_validate).",
      );
      return;
    }

    if (!existsSync(OVERRIDES)) {
      console.warn(
        `render-reproducibility: skipping — _overrides/ not found at ${OVERRIDES}`,
      );
      return;
    }

    if (!existsSync(join(COMMITTED, "SKILL.md"))) {
      console.warn(
        `render-reproducibility: skipping — committed SKILL.md not found at ${join(COMMITTED, "SKILL.md")} (run the initial render first)`,
      );
      return;
    }

    // Dynamically import the renderSkill function from the mjs module.
    // @ts-expect-error — .mjs has no .d.ts
    const { renderSkill } = await import(scriptPath);

    const tmp = mkdtempSync(join(tmpdir(), `render-${SLUG}-`));
    try {
      renderSkill({
        canonicalDir,
        overridesDir: OVERRIDES,
        outputDir: tmp,
      });

      // SKILL.md must be byte-identical
      const committedSkill = readFileSync(join(COMMITTED, "SKILL.md"), "utf8");
      const renderedSkill = readFileSync(join(tmp, "SKILL.md"), "utf8");
      expect(renderedSkill, "SKILL.md drifted from canonical+_overrides").toBe(
        committedSkill,
      );

      // reference/ file set and contents must be byte-identical
      const committedRefs = existsSync(join(COMMITTED, "reference"))
        ? readdirSync(join(COMMITTED, "reference")).sort()
        : [];
      const renderedRefs = existsSync(join(tmp, "reference"))
        ? readdirSync(join(tmp, "reference")).sort()
        : [];

      expect(
        renderedRefs,
        "reference/ file set drifted from canonical+_overrides",
      ).toEqual(committedRefs);

      for (const name of committedRefs) {
        const committed = readFileSync(
          join(COMMITTED, "reference", name),
          "utf8",
        );
        const rendered = readFileSync(join(tmp, "reference", name), "utf8");
        expect(
          rendered,
          `reference/${name} drifted from canonical+_overrides`,
        ).toBe(committed);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

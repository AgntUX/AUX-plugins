import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-google-drive";
const SCRIPT_PATH = join(PLUGIN_ROOT, "../../../scripts/render-skill.mjs");
const CANONICAL_SYNC = join(PLUGIN_ROOT, "../../../canonical/prompts/ingest/skills/sync");
const OVERRIDES = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides`);
const COMMITTED = join(PLUGIN_ROOT, `skills/${SLUG}`);

const SCRIPT_AVAILABLE = existsSync(SCRIPT_PATH);

describe("render reproducibility (lint pass 8 mirror)", () => {
  it("re-running render-skill.mjs produces output byte-identical to the committed tree", async () => {
    if (!SCRIPT_AVAILABLE) {
      // In a standalone contributor sandbox the monorepo scripts/ directory is
      // absent. Lint pass 8 inside agntux_validate is the authoritative check;
      // skip gracefully here rather than erroring the whole file.
      return;
    }

    // Dynamic import — only reached when the script is present.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error — .mjs has no .d.ts
    const { renderSkill } = await import(SCRIPT_PATH);

    const tmp = mkdtempSync(join(tmpdir(), `render-${SLUG}-`));
    try {
      renderSkill({
        canonicalDir: CANONICAL_SYNC,
        overridesDir: OVERRIDES,
        outputDir: tmp,
      });

      const committedSkill = readFileSync(join(COMMITTED, "SKILL.md"), "utf8");
      const renderedSkill = readFileSync(join(tmp, "SKILL.md"), "utf8");
      expect(renderedSkill).toBe(committedSkill);

      const committedRefs = readdirSync(join(COMMITTED, "reference")).sort();
      const renderedRefs = readdirSync(join(tmp, "reference")).sort();
      expect(renderedRefs).toEqual(committedRefs);

      for (const name of committedRefs) {
        const committed = readFileSync(join(COMMITTED, "reference", name), "utf8");
        const rendered = readFileSync(join(tmp, "reference", name), "utf8");
        expect(rendered, `reference/${name} drifted from canonical+_overrides`).toBe(committed);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

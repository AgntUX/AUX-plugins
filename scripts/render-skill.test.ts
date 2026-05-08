/**
 * render-skill.test.ts — golden-file tests for scripts/render-skill.mjs.
 *
 * Three fixtures under scripts/__fixtures__/render-skill/:
 *   minimal       — canonical-only, no overrides, output equals canonical
 *   with-overrides — canonical + frontmatter substitution + wholesale
 *                    resource replace + per-plugin extra resource
 *   with-append   — canonical + frontmatter substitution + section-targeted
 *                    append + silently-stripped markers
 *
 * Each fixture has:
 *   canonical/  → input canonical/.../sync/ tree
 *   _overrides/ → input plugin overrides (may be empty for `minimal`)
 *   expected/   → byte-identical expected output
 *
 * The test renders into a tmp dir and asserts each output file matches the
 * expected file byte-for-byte. Re-rendering the same inputs MUST be byte-
 * identical (idempotency); the lint pass relies on this.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// @ts-expect-error — .mjs has no types
import { renderSkill } from "./render-skill.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, "__fixtures__", "render-skill");

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const d = tempDirs.pop()!;
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `render-skill-${prefix}-`));
  tempDirs.push(d);
  return d;
}

function walkRel(root: string): string[] {
  const out: string[] = [];
  function rec(dir: string) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) rec(full);
      else out.push(relative(root, full));
    }
  }
  rec(root);
  return out;
}

function runFixture(fixtureName: string): {
  outputDir: string;
  expectedDir: string;
} {
  const fxRoot = join(FIXTURES, fixtureName);
  const canonicalDir = join(fxRoot, "canonical");
  const overridesDir = join(fxRoot, "_overrides");
  const expectedDir = join(fxRoot, "expected");
  const outputDir = mkTmp(fixtureName);

  renderSkill({ canonicalDir, overridesDir, outputDir });

  return { outputDir, expectedDir };
}

describe("render-skill: minimal fixture", () => {
  it("renders canonical-only with no surviving placeholders", () => {
    const { outputDir, expectedDir } = runFixture("minimal");

    const expectedFiles = walkRel(expectedDir);
    const actualFiles = walkRel(outputDir);
    expect(actualFiles).toEqual(expectedFiles);

    for (const rel of expectedFiles) {
      const expected = readFileSync(join(expectedDir, rel), "utf8");
      const actual = readFileSync(join(outputDir, rel), "utf8");
      expect(actual, `mismatch in ${rel}`).toBe(expected);
    }
  });
});

describe("render-skill: with-overrides fixture", () => {
  it("substitutes placeholders, replaces canonical runbook, and copies through extra resource", () => {
    const { outputDir, expectedDir } = runFixture("with-overrides");

    const expectedFiles = walkRel(expectedDir);
    const actualFiles = walkRel(outputDir);
    expect(actualFiles).toEqual(expectedFiles);

    for (const rel of expectedFiles) {
      const expected = readFileSync(join(expectedDir, rel), "utf8");
      const actual = readFileSync(join(outputDir, rel), "utf8");
      expect(actual, `mismatch in ${rel}`).toBe(expected);
    }
  });

  it("re-rendering produces byte-identical output (idempotency)", () => {
    const fxRoot = join(FIXTURES, "with-overrides");
    const canonicalDir = join(fxRoot, "canonical");
    const overridesDir = join(fxRoot, "_overrides");
    const a = mkTmp("with-overrides-a");
    const b = mkTmp("with-overrides-b");

    renderSkill({ canonicalDir, overridesDir, outputDir: a });
    renderSkill({ canonicalDir, overridesDir, outputDir: b });

    const filesA = walkRel(a);
    const filesB = walkRel(b);
    expect(filesA).toEqual(filesB);
    for (const rel of filesA) {
      expect(readFileSync(join(b, rel), "utf8")).toBe(
        readFileSync(join(a, rel), "utf8"),
      );
    }
  });
});

describe("render-skill: with-append fixture", () => {
  it("splices append fragment at the marker, strips marker, and silently strips orphan markers", () => {
    const { outputDir, expectedDir } = runFixture("with-append");

    const expectedSkill = readFileSync(join(expectedDir, "SKILL.md"), "utf8");
    const actualSkill = readFileSync(join(outputDir, "SKILL.md"), "utf8");
    expect(actualSkill).toBe(expectedSkill);

    // Every <!-- append: ... --> marker MUST be stripped from the output.
    expect(actualSkill).not.toMatch(/<!--\s*append:/);
  });
});

describe("render-skill: failure modes", () => {
  it("fails when surviving placeholders are not allowed", () => {
    const fxRoot = join(FIXTURES, "with-overrides");
    const canonicalDir = join(fxRoot, "canonical");
    // Use a deliberately-empty overrides dir so {{plugin-slug}} does not
    // resolve. The renderer must throw.
    const emptyOverrides = mkTmp("empty-overrides");
    const outputDir = mkTmp("with-overrides-fail");
    expect(() =>
      renderSkill({ canonicalDir, overridesDir: emptyOverrides, outputDir }),
    ).toThrow();
  });

  it("with allowPlaceholders=true, surviving placeholders pass through", () => {
    const fxRoot = join(FIXTURES, "with-overrides");
    const canonicalDir = join(fxRoot, "canonical");
    const emptyOverrides = mkTmp("empty-overrides2");
    const outputDir = mkTmp("with-overrides-allow");
    renderSkill({
      canonicalDir,
      overridesDir: emptyOverrides,
      outputDir,
      flags: { allowPlaceholders: true },
    });
    const skill = readFileSync(join(outputDir, "SKILL.md"), "utf8");
    expect(skill).toContain("{{plugin-slug}}");
  });
});

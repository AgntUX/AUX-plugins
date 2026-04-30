/**
 * skills-structure.test.ts
 *
 * Structural test: verifies that every `agntux-core:*` skill is shaped
 * as a directory containing SKILL.md, per the Claude Code plugin spec.
 * Flat `skills/{name}.md` files are silently dropped by the host's
 * plugin discovery — that bug is what made `/ux` invisible in 2.0.0.
 * This test is the regression guard.
 *
 * Also asserts that:
 *   - The eight named skills the README + listing.yaml advertise all
 *     exist as directories.
 *   - The shared `_preconditions.md` reference exists.
 *   - The flat `skills/orchestrator.md` (3.0.0 deletion) is gone.
 *   - Every SKILL.md has YAML frontmatter declaring `name:` and
 *     `description:` (the two fields the host needs to register and
 *     auto-dispatch the skill).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");

const NAMED_SKILLS = [
  "onboard",
  "profile",
  "teach",
  "triage",
  "schema",
  "sync",
  "ask",
  "feedback-review",
] as const;

function readFrontmatter(skillPath: string): Record<string, string> {
  const src = readFileSync(skillPath, "utf-8");
  const match = src.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fm[key] = value;
  }
  return fm;
}

describe("agntux-core skills directory structure", () => {
  it("flat skills/orchestrator.md (the 2.0.0 invisible-skill bug) is gone", () => {
    expect(existsSync(join(SKILLS_DIR, "orchestrator.md"))).toBe(false);
  });

  it("the shared _preconditions.md reference exists", () => {
    // Leading underscore keeps it out of the slash-command surface; it
    // is referenced from every entry-point skill's body.
    expect(existsSync(join(SKILLS_DIR, "_preconditions.md"))).toBe(true);
  });

  for (const name of NAMED_SKILLS) {
    describe(`/agntux-core:${name}`, () => {
      const dirPath = join(SKILLS_DIR, name);
      const skillPath = join(dirPath, "SKILL.md");

      it("is a directory shaped as skills/{name}/SKILL.md", () => {
        expect(existsSync(dirPath)).toBe(true);
        expect(existsSync(skillPath)).toBe(true);
      });

      it("has frontmatter declaring name + description", () => {
        const fm = readFrontmatter(skillPath);
        expect(fm.name).toBe(name);
        expect(fm.description).toBeTruthy();
        expect(fm.description.length).toBeGreaterThan(20);
      });
    });
  }
});

describe("agntux-core skills frontmatter conventions", () => {
  it("/agntux-core:feedback-review opts out of model auto-invocation", () => {
    // Per spec: pattern-feedback runs only on schedule or by direct
    // user slash invocation. Auto-dispatching it from natural-language
    // chat would be surprising.
    const skillPath = join(SKILLS_DIR, "feedback-review", "SKILL.md");
    const fm = readFrontmatter(skillPath);
    expect(fm["disable-model-invocation"]).toBe("true");
  });

  it("argument-taking skills declare an argument-hint", () => {
    // /teach, /schema, /sync take a plugin slug or sub-command.
    for (const name of ["teach", "schema", "sync"]) {
      const fm = readFrontmatter(join(SKILLS_DIR, name, "SKILL.md"));
      expect(
        fm["argument-hint"],
        `${name} should declare argument-hint`,
      ).toBeTruthy();
    }
  });
});

describe("agntux-core plugin manifest version", () => {
  it("plugin.json is at version 3.0.0 (the breaking skill-split)", () => {
    const manifestPath = join(
      PLUGIN_ROOT,
      ".claude-plugin",
      "plugin.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(manifest.version).toBe("3.0.0");
  });
});

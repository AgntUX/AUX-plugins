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
  "agntux-onboard",
  "agntux-profile",
  "agntux-teach",
  "agntux-triage",
  "agntux-schema",
  "agntux-sync",
  "agntux-ask",
  "agntux-feedback-review",
] as const;

// Read a TypeScript view-tool source file and collapse string-concatenation
// continuations (`" +\n  "`) so substring assertions can match prose that
// the formatter wrapped across multiple lines. Mirrors what TypeScript would
// emit at runtime — the description string the host actually sees.
function readToolSource(p: string): string {
  const raw = readFileSync(p, "utf-8");
  return raw.replace(/"\s*\+\s*\n\s*"/g, "");
}

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

  it("the shared _resolve-root.md reference exists", () => {
    // Owns the resolve-then-route ladder Check 0 of _preconditions.md
    // delegates to. Removing it would silently re-introduce the old
    // fail-loud refusal behaviour for users with ~/agntux populated
    // but a non-agntux cwd.
    expect(existsSync(join(SKILLS_DIR, "_resolve-root.md"))).toBe(true);
  });

  for (const name of NAMED_SKILLS) {
    describe(`/${name}`, () => {
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
  it("/agntux-feedback-review opts out of model auto-invocation", () => {
    // Per spec: pattern-feedback runs only on schedule or by direct
    // user slash invocation. Auto-dispatching it from natural-language
    // chat would be surprising.
    const skillPath = join(SKILLS_DIR, "agntux-feedback-review", "SKILL.md");
    const fm = readFrontmatter(skillPath);
    expect(fm["disable-model-invocation"]).toBe("true");
  });

  it("argument-taking skills declare an argument-hint", () => {
    // /teach, /schema, /sync take a plugin slug or sub-command.
    for (const name of ["agntux-teach", "agntux-schema", "agntux-sync"]) {
      const fm = readFrontmatter(join(SKILLS_DIR, name, "SKILL.md"));
      expect(
        fm["argument-hint"],
        `${name} should declare argument-hint`,
      ).toBeTruthy();
    }
  });
});

describe("UI handler routing surface (post de-fork — descriptors own it)", () => {
  // The legacy `agents/ui-handlers/{triage,entity-browser}.md` operational
  // manifests are gone — every field they carried (verb_phrases, view_tool,
  // resource_uri, structured_content_schema, follow_up_intents,
  // degraded_states) now lives on the view tool's descriptor in
  // `mcp-server/src/tools/triage-view.ts`. The tests below assert the
  // surface alignment lives there now.
  const triageViewPath = join(PLUGIN_ROOT, "mcp-server", "src", "tools", "triage-view.ts");

  it("the entire agents/ directory is gone (no other agents survive in agntux-core)", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });

  it("triage-view tool source exists at mcp-server/src/tools/triage-view.ts", () => {
    expect(existsSync(triageViewPath)).toBe(true);
  });

  it("triage-view declares the v6.0.0+ namespaced tool name agntux_core_triage_view", () => {
    const src = readFileSync(triageViewPath, "utf-8");
    expect(src).toContain('name: "agntux_core_triage_view"');
  });

  it("triage-view advertises ui://triage as the resource URI in both _meta.ui and _meta['ui/resourceUri']", () => {
    const src = readFileSync(triageViewPath, "utf-8");
    expect(src).toContain('TRIAGE_RESOURCE_URI = "ui://triage"');
    expect(src).toMatch(/ui:\s*\{\s*resourceUri:\s*TRIAGE_RESOURCE_URI/);
    expect(src).toMatch(/"ui\/resourceUri":\s*TRIAGE_RESOURCE_URI/);
  });

  it("triage-view description carries the user-facing trigger phrases inline (the host's tool selector matches against this)", () => {
    const src = readToolSource(triageViewPath);
    expect(src).toContain("/agntux-triage");
    for (const phrase of [
      "show triage",
      "what's hot",
      "what should I look at",
      "what's on my plate",
      "triage me",
      "show me my action items",
      "what should I do today",
    ]) {
      expect(src).toContain(phrase);
    }
  });

  it("triage-view inputSchema is empty (zero-arg call site — host invokes with `{}`)", () => {
    const src = readFileSync(triageViewPath, "utf-8");
    const inputSchemaMatch = src.match(/inputSchema:\s*\{[\s\S]*?required:\s*\[[^\]]*\],?\s*\}/);
    expect(inputSchemaMatch).toBeTruthy();
    const block = inputSchemaMatch![0];
    expect(block).toContain("properties: {}");
    expect(block).toContain("required: []");
    // Legacy back-compat fields (view_handled_days, limit) must be absent
    // from the input surface — they remain server-side as DEFAULT_*
    // constants.
    expect(block).not.toContain("view_handled_days");
    expect(block).not.toContain("limit");
  });

  it("triage-view structured-error envelope declares the canonical degraded-state codes", () => {
    const src = readFileSync(triageViewPath, "utf-8");
    for (const code of ["actions_index_missing", "license_paused"]) {
      expect(src).toContain(`"${code}"`);
    }
  });
});

describe("agntux-core plugin manifest version", () => {
  it("plugin.json version matches the most-recent CHANGELOG entry", () => {
    const manifestPath = join(
      PLUGIN_ROOT,
      ".claude-plugin",
      "plugin.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);

    // Cross-check: the manifest version MUST match the first non-Unreleased
    // header in CHANGELOG.md. Same invariant the marketplace linter enforces;
    // surfacing it here gives a fast vitest signal so the literal-version
    // pin doesn't drift across version bumps (which is exactly what happened
    // when 6.2.1 was pinned and 6.2.2-6.2.5 shipped without updating it).
    const changelogPath = join(PLUGIN_ROOT, "CHANGELOG.md");
    const changelog = readFileSync(changelogPath, "utf-8");
    const versionHeader = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
    expect(versionHeader, "CHANGELOG.md is missing a versioned ## header").not.toBeNull();
    if (versionHeader) {
      expect(manifest.version).toBe(versionHeader[1]);
    }
  });

  it("mcp-server/package.json declares the ./agntux-root subpath export", () => {
    const mcpPkgPath = join(PLUGIN_ROOT, "mcp-server", "package.json");
    const pkg = JSON.parse(readFileSync(mcpPkgPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const exports = pkg.exports as Record<string, unknown>;
    expect(exports).toBeDefined();
    expect(exports["./agntux-root"]).toBeDefined();
    // Subpath exports use the conditional shape with both `types` and `import`
    // fields so NodeNext consumers get full type information.
    const subpath = exports["./agntux-root"] as Record<string, unknown>;
    expect(subpath.types).toBe("./dist/agntux-root.d.ts");
    expect(subpath.import).toBe("./dist/agntux-root.js");
  });
});

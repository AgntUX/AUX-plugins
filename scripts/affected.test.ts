/**
 * affected.test.ts — unit tests for the pure changed-plugin core that drives the
 * scoped CI checks. The git-touching parts (changedPathsFromGit) are intentionally
 * NOT tested here — they shell out and are exercised end-to-end in CI; the
 * fail-safe-to-full behavior on a null diff is covered via main()'s contract.
 */

import { afterEach, describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs with no type declarations
import { computeAffected, changedPathsFromGit } from "./affected.mjs";

describe("computeAffected", () => {
  it("scopes to a single plugin when only its files change", () => {
    const r = computeAffected([
      "plugins/agntux-notion/__tests__/cold-start.test.ts",
      "plugins/agntux-notion/.claude-plugin/plugin.json",
    ]);
    expect(r).toEqual({ mode: "scoped", plugins: ["agntux-notion"] });
  });

  it("collects and de-dupes multiple affected plugins, sorted", () => {
    const r = computeAffected([
      "plugins/agntux-stripe/README.md",
      "plugins/agntux-notion/CHANGELOG.md",
      "plugins/agntux-notion/.claude-plugin/plugin.json",
    ]);
    expect(r).toEqual({ mode: "scoped", plugins: ["agntux-notion", "agntux-stripe"] });
  });

  it("falls back to full when a shared root changes (canonical/)", () => {
    const r = computeAffected([
      "plugins/agntux-notion/CHANGELOG.md",
      "canonical/prompts/ingest/skills/sync/SKILL.md",
    ]);
    expect(r).toEqual({ mode: "full", plugins: [] });
  });

  it.each([
    "scripts/affected.mjs",
    "packages/ui-primitives/index.ts",
    "lib/payload.ts",
    "vitest.config.ts",
    ".github/workflows/test.yml",
    "package.json",
    "tsconfig.json",
  ])("falls back to full when shared path %s changes", (p) => {
    expect(computeAffected([p]).mode).toBe("full");
  });

  it("treats a bare plugins/<file> (no slug subdir) as shared → full", () => {
    expect(computeAffected(["plugins/README.md"]).mode).toBe("full");
  });

  it("rejects a shell-hostile slug as full (Actions-injection guard)", () => {
    expect(computeAffected(["plugins/foo;curl evil/x.ts"]).mode).toBe("full");
    expect(computeAffected(["plugins/Foo_Bar/x.ts"]).mode).toBe("full"); // uppercase/underscore not a valid slug
    expect(computeAffected(["plugins/$(rm -rf)/x.ts"]).mode).toBe("full");
  });

  it("ignores blank/whitespace entries", () => {
    const r = computeAffected(["", "  ", "plugins/agntux-slack/x.ts"]);
    expect(r).toEqual({ mode: "scoped", plugins: ["agntux-slack"] });
  });

  it("empty change list → scoped with no plugins (run only shared dirs)", () => {
    expect(computeAffected([])).toEqual({ mode: "scoped", plugins: [] });
  });

  it("accepts a new plugin (create) as scoped to that slug", () => {
    const r = computeAffected([
      "plugins/agntux-newthing/.claude-plugin/plugin.json",
      "plugins/agntux-newthing/CHANGELOG.md",
    ]);
    expect(r).toEqual({ mode: "scoped", plugins: ["agntux-newthing"] });
  });
});

describe("changedPathsFromGit base resolution (fail-safe-to-full)", () => {
  const saved = {
    GITHUB_PR_BASE_SHA: process.env.GITHUB_PR_BASE_SHA,
    GITHUB_BASE_REF: process.env.GITHUB_BASE_REF,
    GITHUB_EVENT_BEFORE: process.env.GITHUB_EVENT_BEFORE,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns null (→ caller runs FULL) when no base SHA/ref is available — never HEAD~1", () => {
    delete process.env.GITHUB_PR_BASE_SHA;
    delete process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_EVENT_BEFORE;
    // No --base and no event env → no candidates → null (NOT a HEAD~1 under-test).
    expect(changedPathsFromGit({})).toBeNull();
  });

  it("ignores an all-zero before-SHA (branch create / initial force-push) → null → full", () => {
    delete process.env.GITHUB_PR_BASE_SHA;
    delete process.env.GITHUB_BASE_REF;
    process.env.GITHUB_EVENT_BEFORE = "0000000000000000000000000000000000000000";
    expect(changedPathsFromGit({})).toBeNull();
  });
});

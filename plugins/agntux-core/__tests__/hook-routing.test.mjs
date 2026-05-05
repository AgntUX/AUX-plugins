/**
 * hook-routing.test.mjs
 *
 * Structural tests for hook routing. After license enforcement moved to the
 * MCP server (gate at tools/call + resources/read), only the schema/index
 * hooks remain in this plugin:
 *   - PreToolUse  → validate-schema.mjs   (matcher: Write|Edit)
 *   - PreToolUse  → validate-contract.mjs (matcher: Write|Edit)
 *   - PostToolUse → maintain-index.mjs    (matcher: Write|Edit)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = join(PLUGIN_ROOT, "hooks");

describe("hooks.json structure", () => {
  it("hooks.json exists", () => {
    expect(existsSync(join(HOOKS_DIR, "hooks.json"))).toBe(true);
  });

  it("does not register license-check or license-validate", () => {
    const hooks = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));
    const all = JSON.stringify(hooks);
    expect(all).not.toContain("license-check");
    expect(all).not.toContain("license-validate");
  });

  it("has PostToolUse lane with maintain-index and Write|Edit matcher", () => {
    const hooks = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));
    const postToolUse = hooks.hooks?.PostToolUse;
    expect(Array.isArray(postToolUse)).toBe(true);
    const entry = postToolUse.find((e) =>
      (e.hooks ?? []).some((h) => (h.command ?? "").includes("maintain-index.mjs"))
    );
    expect(entry).toBeDefined();
    expect(entry.matcher).toBe("Write|Edit");
  });

  it("has PreToolUse lane with validate-schema and Write|Edit matcher", () => {
    const hooks = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));
    const preToolUse = hooks.hooks?.PreToolUse;
    const entry = preToolUse.find((e) =>
      (e.hooks ?? []).some((h) => (h.command ?? "").includes("validate-schema.mjs"))
    );
    expect(entry).toBeDefined();
    expect(entry.matcher).toBe("Write|Edit");
  });

  it("has PreToolUse lane with validate-contract and Write|Edit matcher", () => {
    const hooks = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));
    const preToolUse = hooks.hooks?.PreToolUse;
    const entry = preToolUse.find((e) =>
      (e.hooks ?? []).some((h) => (h.command ?? "").includes("validate-contract.mjs"))
    );
    expect(entry).toBeDefined();
    expect(entry.matcher).toBe("Write|Edit");
  });
});

describe("hook files exist", () => {
  it("hooks/maintain-index.mjs exists", () => {
    expect(existsSync(join(HOOKS_DIR, "maintain-index.mjs"))).toBe(true);
  });

  it("hooks/validate-schema.mjs exists", () => {
    expect(existsSync(join(HOOKS_DIR, "validate-schema.mjs"))).toBe(true);
  });

  it("hooks/validate-contract.mjs exists", () => {
    expect(existsSync(join(HOOKS_DIR, "validate-contract.mjs"))).toBe(true);
  });
});

describe("hook lib files exist", () => {
  const LIB = join(HOOKS_DIR, "lib");
  const required = ["agntux-root.mjs", "frontmatter.mjs", "schema-lock.mjs", "summary.mjs"];
  for (const f of required) {
    it(`lib/${f} exists`, () => {
      expect(existsSync(join(LIB, f))).toBe(true);
    });
  }
});

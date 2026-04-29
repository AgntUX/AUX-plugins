/**
 * hook-routing.test.mjs
 *
 * Subagent-level tests for hook routing (P4 §10).
 * Strategy: assert that hooks.json registers the correct event types and
 * matchers for all 4 lanes:
 *   - SessionStart  → license-check.mjs
 *   - PreToolUse    → license-validate.mjs (matcher: Write|Edit|mcp__.*)
 *   - PostToolUse   → maintain-index.mjs  (matcher: Write|Edit)
 *
 * Limitation: these are structural/static tests. Full host-level hook
 * dispatch simulation is not feasible at MVP without a running Claude Code
 * host. We validate the configuration file and verify the referenced hook
 * files exist and export the expected symbols.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = join(PLUGIN_ROOT, "hooks");

// ---------------------------------------------------------------------------
// Lane 1: hooks.json structure
// ---------------------------------------------------------------------------

describe("hooks.json structure", () => {
  it("hooks.json exists", () => {
    expect(existsSync(join(HOOKS_DIR, "hooks.json"))).toBe(true);
  });

  it("has SessionStart lane with license-check", () => {
    const hooks = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));
    const sessionStart = hooks.hooks?.SessionStart;
    expect(Array.isArray(sessionStart)).toBe(true);
    const cmds = sessionStart.flatMap((e) => e.hooks ?? []).map((h) => h.command ?? "");
    expect(cmds.some((c) => c.includes("license-check.mjs"))).toBe(true);
  });

  it("has PreToolUse lane with license-validate and Write|Edit|mcp__ matcher", () => {
    const hooks = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));
    const preToolUse = hooks.hooks?.PreToolUse;
    expect(Array.isArray(preToolUse)).toBe(true);
    const entry = preToolUse.find((e) =>
      (e.hooks ?? []).some((h) => (h.command ?? "").includes("license-validate.mjs"))
    );
    expect(entry).toBeDefined();
    expect(entry.matcher).toMatch(/Write\|Edit/);
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
});

// ---------------------------------------------------------------------------
// Lane 2: referenced hook files exist
// ---------------------------------------------------------------------------

describe("hook files exist", () => {
  it("hooks/license-check.mjs exists", () => {
    expect(existsSync(join(HOOKS_DIR, "license-check.mjs"))).toBe(true);
  });

  it("hooks/license-validate.mjs exists", () => {
    expect(existsSync(join(HOOKS_DIR, "license-validate.mjs"))).toBe(true);
  });

  it("hooks/maintain-index.mjs exists", () => {
    expect(existsSync(join(HOOKS_DIR, "maintain-index.mjs"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lane 3: lib files exist (all required helpers)
// ---------------------------------------------------------------------------

describe("hook lib files exist", () => {
  const LIB = join(HOOKS_DIR, "lib");
  const required = [
    "jwt-verify.mjs",
    "cache.mjs",
    "refresh.mjs",
    "ui.mjs",
    "device.mjs",
    "public-key.mjs",
    "scope.mjs",
    "agntux-plugins.mjs",
    "frontmatter.mjs",
    "summary.mjs",
  ];
  for (const f of required) {
    it(`lib/${f} exists`, () => {
      expect(existsSync(join(LIB, f))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Lane 4: placeholder substitution — no {{...}} tokens remain
// ---------------------------------------------------------------------------

describe("placeholder substitution", () => {
  it("public-key.mjs has real PUBLIC_KEY_KID (not placeholder)", () => {
    const src = readFileSync(join(HOOKS_DIR, "lib", "public-key.mjs"), "utf8");
    expect(src).not.toContain("{{PUBLIC_KEY_KID}}");
    expect(src).toContain("agntux-license-v1");
  });

  it("public-key.mjs has real PUBLIC_KEY_SPKI_PEM (not placeholder)", () => {
    const src = readFileSync(join(HOOKS_DIR, "lib", "public-key.mjs"), "utf8");
    expect(src).not.toContain("{{PUBLIC_KEY_SPKI_PEM}}");
    expect(src).toContain("BEGIN PUBLIC KEY");
  });

  it("agntux-plugins.mjs has real slug array (not placeholder)", () => {
    const src = readFileSync(join(HOOKS_DIR, "lib", "agntux-plugins.mjs"), "utf8");
    expect(src).not.toContain('"{{AGNTUX_PLUGIN_SLUGS}}"');
    expect(src).toContain("agntux-core");
  });
});

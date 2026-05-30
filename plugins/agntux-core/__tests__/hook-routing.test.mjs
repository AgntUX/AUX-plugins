/**
 * hook-routing.test.mjs
 *
 * Structural tests for hook routing. After license enforcement moved to the
 * MCP server (gate at tools/call + resources/read) and the 2026-05-08
 * autonomy-boundary sweep added validate-write-lane + session-end-rebuild,
 * the registered lanes are:
 *   - PreToolUse  → validate-schema.mjs       (matcher: Write|Edit)
 *   - PreToolUse  → validate-contract.mjs     (matcher: Write|Edit)
 *   - PreToolUse  → lint-entity-shape.mjs     (matcher: Write|Edit)
 *   - PreToolUse  → validate-cursor.mjs       (matcher: Write|Edit)
 *   - PreToolUse  → validate-write-lane.mjs   (matcher: Write|Edit)
 *   - PostToolUse → maintain-index.mjs        (matcher: Write|Edit)
 *   - SessionEnd  → session-end-rebuild.mjs   (no matcher)
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

  it("has PreToolUse lane with validate-write-lane and Write|Edit matcher", () => {
    // PR #4 (2026-05-08) added the autonomy-boundary write-lane hook.
    const hooks = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));
    const preToolUse = hooks.hooks?.PreToolUse;
    const entry = preToolUse.find((e) =>
      (e.hooks ?? []).some((h) => (h.command ?? "").includes("validate-write-lane.mjs"))
    );
    expect(entry).toBeDefined();
    expect(entry.matcher).toBe("Write|Edit");
  });

  it("has SessionEnd lane with session-end-rebuild", () => {
    // PR #4 (2026-05-08) added the SessionEnd belt-and-suspenders rebuild.
    const hooks = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));
    const sessionEnd = hooks.hooks?.SessionEnd;
    expect(Array.isArray(sessionEnd)).toBe(true);
    const entry = sessionEnd.find((e) =>
      (e.hooks ?? []).some((h) => (h.command ?? "").includes("session-end-rebuild.mjs"))
    );
    expect(entry).toBeDefined();
  });

  it("routes EVERY hook through bin/agntux-node.sh (zero-user-Node runtime)", () => {
    // Hooks must run under the AgntUX desktop runtime on a machine with no
    // system Node — never bare `node`. Catches a revert to `node <hook>.mjs`.
    const hooks = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));
    const commands = Object.values(hooks.hooks ?? {})
      .flat()
      .flatMap((entry) => (entry.hooks ?? []).map((h) => h.command ?? ""));
    expect(commands.length).toBe(7); // 5 PreToolUse + 1 PostToolUse + 1 SessionEnd
    for (const cmd of commands) {
      expect(cmd).toContain("bin/agntux-node.sh");
      // The launcher is invoked via `sh` so it needs no exec bit (the bit does
      // not survive Claude Desktop's zip→unzip round-trip).
      expect(cmd.startsWith("sh ")).toBe(true);
      expect(cmd).not.toMatch(/(^|\s)node\s+\$\{CLAUDE_PLUGIN_ROOT\}/);
    }
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

  it("hooks/validate-write-lane.mjs exists (PR #4)", () => {
    expect(existsSync(join(HOOKS_DIR, "validate-write-lane.mjs"))).toBe(true);
  });

  it("hooks/session-end-rebuild.mjs exists (PR #4)", () => {
    expect(existsSync(join(HOOKS_DIR, "session-end-rebuild.mjs"))).toBe(true);
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

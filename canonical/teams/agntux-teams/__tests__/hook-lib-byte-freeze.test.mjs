// Byte-freeze invariant tests.
// The master-plan hooks invariant requires that helper modules under
// hooks/lib/ be byte-identical copies of the canonical sources. These
// tests catch drift.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_HOOKS_LIB = join(__dirname, "..", "hooks", "lib");
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const CANONICAL_HOOKS_LIB = join(REPO_ROOT, "canonical", "hooks", "lib");
const AGNTUX_CORE_HOOKS_LIB = join(
  REPO_ROOT,
  "plugins",
  "agntux-core",
  "hooks",
  "lib",
);

function read(path) {
  return readFileSync(path, "utf8");
}

describe("hooks/lib/ byte-freeze invariant", () => {
  it("trigger-key.mjs matches canonical/hooks/lib/trigger-key.mjs verbatim", () => {
    const plugin = read(join(PLUGIN_HOOKS_LIB, "trigger-key.mjs"));
    const canonical = read(join(CANONICAL_HOOKS_LIB, "trigger-key.mjs"));
    expect(plugin).toBe(canonical);
  });

  it("agntux-root.mjs matches canonical/hooks/lib/agntux-root.mjs verbatim", () => {
    const plugin = read(join(PLUGIN_HOOKS_LIB, "agntux-root.mjs"));
    const canonical = read(join(CANONICAL_HOOKS_LIB, "agntux-root.mjs"));
    expect(plugin).toBe(canonical);
  });

  it("frontmatter.mjs matches agntux-core/hooks/lib/frontmatter.mjs verbatim", () => {
    // frontmatter.mjs's source of truth lives in agntux-core until a
    // canonical/hooks/lib/frontmatter.mjs is hoisted — keep parity with
    // wherever the live agntux-core copy lives so the validator behaviour
    // stays identical across plugins.
    const plugin = read(join(PLUGIN_HOOKS_LIB, "frontmatter.mjs"));
    const core = read(join(AGNTUX_CORE_HOOKS_LIB, "frontmatter.mjs"));
    expect(plugin).toBe(core);
  });

  it("schema-lock.mjs matches agntux-core/hooks/lib/schema-lock.mjs verbatim", () => {
    const plugin = read(join(PLUGIN_HOOKS_LIB, "schema-lock.mjs"));
    const core = read(join(AGNTUX_CORE_HOOKS_LIB, "schema-lock.mjs"));
    expect(plugin).toBe(core);
  });
});

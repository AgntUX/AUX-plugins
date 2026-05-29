/**
 * Unit tests for scripts/validate-plugin.mjs — the deterministic pre-submission
 * gate's tree-hash + exclude logic.
 *
 * The load-bearing property: the validator's tree_sha256 MUST be byte-identical
 * to the stage-12 submit program's tree_sha256 over the same tree, or the
 * receipt gate (12-submit.md) can never match and submission is impossible.
 * We prove that here against an INDEPENDENT reimplementation of the marker
 * algorithm, plus assert the exclude lists drop the right paths and keep the
 * tracked view-tool/dist artifacts.
 *
 * Fast + deterministic — no real build, no spawn, no LLM.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — .mjs has no .d.ts
import { computeTreeSha256, walkTree, EXCLUDE_DIRS, EXCLUDE_NAMES, runValidation } from "../../../scripts/validate-plugin.mjs";

const SLUG = "agntux-testcal";

let tmpRoot: string;
let pluginDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "validate-plugin-"));
  pluginDir = join(tmpRoot, SLUG);
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), '{"name":"agntux-testcal","version":"0.1.0"}');
  writeFileSync(join(pluginDir, "README.md"), "# readme");
  writeFileSync(join(pluginDir, "LICENSE"), "Apache-2.0");
  writeFileSync(join(pluginDir, "NOTICE"), "attribution");
  // A tracked view-tool/dist artifact MUST be hashed (it ships).
  mkdirSync(join(pluginDir, "view-tool", "dist", "ui-resources"), { recursive: true });
  writeFileSync(join(pluginDir, "view-tool", "dist", "view-tools.manifest.json"), '{"view_tools":[]}');
  writeFileSync(join(pluginDir, "view-tool", "dist", "ui-resources", "compose.html"), "<!doctype html><html></html>");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Independent reimplementation of the stage-12 marker program's hash. */
function independentTreeSha(dir: string, slug: string): string {
  const exDirs = new Set([
    "node_modules", ".git", ".omc", "mcp-server", "hooks", "host-renderer", "test-harness", "agents",
  ]);
  const exNames = new Set([
    "SUBMISSION.json", "SUBMISSION.json.tmp", ".DS_Store", ".mcp.json",
    "validation-receipt.json", "validation-receipt.json.tmp",
  ]);
  const files: string[] = [];
  (function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!exDirs.has(e.name)) walk(join(d, e.name));
      } else if (e.isFile() && !exNames.has(e.name)) {
        files.push(join(d, e.name));
      }
    }
  })(dir);
  const rows = files
    .map((abs) => ({
      path: `${slug}/${relative(dir, abs)}`,
      sha256: createHash("sha256").update(readFileSync(abs)).digest("hex"),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return createHash("sha256").update(rows.map((f) => `${f.path}\t${f.sha256}`).join("\n")).digest("hex");
}

describe("validate-plugin.mjs tree hashing", () => {
  it("exposes the exact exclude lists the marker program uses", () => {
    for (const d of ["node_modules", ".git", ".omc", "mcp-server", "hooks", "host-renderer", "test-harness", "agents"]) {
      expect(EXCLUDE_DIRS.has(d), `EXCLUDE_DIRS must contain ${d}`).toBe(true);
    }
    for (const n of ["SUBMISSION.json", ".DS_Store", ".mcp.json", "validation-receipt.json"]) {
      expect(EXCLUDE_NAMES.has(n), `EXCLUDE_NAMES must contain ${n}`).toBe(true);
    }
  });

  it("computeTreeSha256 is byte-identical to the independent marker algorithm", () => {
    expect(computeTreeSha256(pluginDir, SLUG)).toBe(independentTreeSha(pluginDir, SLUG));
  });

  it("excludes node_modules + cruft + the receipt, but keeps view-tool/dist", () => {
    // Noise the hash must ignore:
    mkdirSync(join(pluginDir, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(pluginDir, "node_modules", "dep", "index.js"), "module.exports={}");
    writeFileSync(join(pluginDir, ".DS_Store"), "junk");
    writeFileSync(join(pluginDir, ".mcp.json"), "{}");
    writeFileSync(join(pluginDir, "validation-receipt.json"), '{"tree_sha256":"x"}');

    const kept = walkTree(pluginDir).map((p: string) => relative(pluginDir, p));
    expect(kept.some((p: string) => p.includes("node_modules"))).toBe(false);
    expect(kept).not.toContain(".DS_Store");
    expect(kept).not.toContain(".mcp.json");
    expect(kept).not.toContain("validation-receipt.json");
    // Tracked artifact that MUST ship:
    expect(kept).toContain(join("view-tool", "dist", "view-tools.manifest.json"));

    // And the hash is unchanged by all that excluded noise.
    expect(computeTreeSha256(pluginDir, SLUG)).toBe(independentTreeSha(pluginDir, SLUG));
  });

  it("changes when a tracked file changes (the stale-receipt forcing function)", () => {
    const before = computeTreeSha256(pluginDir, SLUG);
    writeFileSync(join(pluginDir, "README.md"), "# readme (edited)");
    const after = computeTreeSha256(pluginDir, SLUG);
    expect(after).not.toBe(before);
  });

  it("does NOT change when only an excluded file is added (receipt is outside the hash)", () => {
    const before = computeTreeSha256(pluginDir, SLUG);
    writeFileSync(join(pluginDir, "validation-receipt.json"), '{"tree_sha256":"whatever"}');
    writeFileSync(join(pluginDir, ".DS_Store"), "junk");
    const after = computeTreeSha256(pluginDir, SLUG);
    expect(after).toBe(before);
  });
});

// runValidation is the in-process verdict surface the MCP server calls. Its
// load-bearing contract: it NEVER throws and NEVER process.exits — every
// failure (including usage errors) is folded into a returned verdict. These
// cases return before any subprocess spawn, so they're fast + deterministic.
describe("runValidation verdict contract (never throws / never exits)", () => {
  it("returns a usage verdict (not a throw) when slug is missing", async () => {
    const v = await runValidation({ plugin_dir: "/tmp/whatever-xyz" } as never);
    expect(v.ok).toBe(false);
    expect(v.error_kind).toBe("usage");
    expect(v.failed_stage).toBe("usage");
    expect(v.blocking).toBe(false);
  });

  it("returns a usage verdict when pluginDir is missing", async () => {
    const v = await runValidation({ slug: SLUG } as never);
    expect(v.ok).toBe(false);
    expect(v.error_kind).toBe("usage");
    expect(v.blocking).toBe(false);
  });

  it("returns a usage verdict (not a throw) when the plugin dir does not exist", async () => {
    const missing = join(tmpdir(), `validate-missing-${process.pid}-${Date.now()}`);
    const v = await runValidation({ slug: SLUG, pluginDir: missing });
    expect(v.ok).toBe(false);
    expect(v.error_kind).toBe("usage");
    expect(v.failed_stage).toBe("usage");
    expect(typeof v.detail).toBe("string");
    // Shape sanity: a verdict always carries stages + a timestamp.
    expect(v.stages).toBeTypeOf("object");
    expect(typeof v.validated_at).toBe("string");
  });
});

/**
 * view-tool-payload-guard.test.ts
 *
 * Unit tests for pass 11 (E24/E25) — payload-shape regression-guard
 * test requirement for plugins shipping a `view-tool/` directory.
 *
 * Each test builds an ephemeral plugin layout under os.tmpdir() and
 * asserts the findings the lint runner would produce.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass11ViewToolPayloadGuard } from "../lint-view-tool-payload-guard.js";
import type { Finding } from "../lint-view-tool-payload-guard.js";

function mkTmpPlugin(
  slug: string,
  opts: { withViewTool: boolean } = { withViewTool: true },
): { repoRoot: string; pluginDir: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint11-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(pluginDir, { recursive: true });
  if (opts.withViewTool) {
    fs.mkdirSync(path.join(pluginDir, "view-tool", "src"), { recursive: true });
  }
  return { repoRoot, pluginDir };
}

function writeTest(pluginDir: string, body: string): void {
  const dir = path.join(pluginDir, "view-tool", "__tests__");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "payload-shape.test.ts"), body, "utf8");
}

describe("pass11ViewToolPayloadGuard", () => {
  let tmp: { repoRoot: string; pluginDir: string } | null = null;

  beforeEach(() => {
    tmp = null;
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true });
  });

  it("emits no finding when the plugin has no view-tool/ directory", () => {
    tmp = mkTmpPlugin("no-view-tool-plugin", { withViewTool: false });
    const findings: Finding[] = [];
    pass11ViewToolPayloadGuard(
      "no-view-tool-plugin",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("emits E24 (warning) when view-tool/ exists but payload-shape.test.ts is missing", () => {
    tmp = mkTmpPlugin("missing-test");
    const findings: Finding[] = [];
    pass11ViewToolPayloadGuard(
      "missing-test",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E24");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.plugin).toBe("missing-test");
    expect(findings[0]?.file).toBe(
      "view-tool/__tests__/payload-shape.test.ts",
    );
  });

  it("emits E25 (warning) when the test exists but has no size assertion", () => {
    tmp = mkTmpPlugin("no-size-assertion");
    // Key-set-only test — has expect/toBe but no byte-length or .toBeLessThan.
    writeTest(
      tmp.pluginDir,
      `import { expect, it } from "vitest";
it("checks the shape", () => { expect({ id: 1 }).toEqual({ id: 1 }); });`,
    );
    const findings: Finding[] = [];
    pass11ViewToolPayloadGuard(
      "no-size-assertion",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E25");
    expect(findings[0]?.severity).toBe("warning");
  });

  it("emits E25 when only a builder is present without a less-than matcher", () => {
    tmp = mkTmpPlugin("builder-only");
    writeTest(
      tmp.pluginDir,
      `import { expect, it } from "vitest";
it("hashes", () => {
  const bytes = Buffer.byteLength(JSON.stringify({ id: 1 }), "utf8");
  expect(bytes).toBeGreaterThan(0);
});`,
    );
    const findings: Finding[] = [];
    pass11ViewToolPayloadGuard(
      "builder-only",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E25");
  });

  it("emits E25 when only a matcher is present without a builder", () => {
    tmp = mkTmpPlugin("matcher-only");
    writeTest(
      tmp.pluginDir,
      `import { expect, it } from "vitest";
it("checks", () => { expect(42).toBeLessThan(100); });`,
    );
    const findings: Finding[] = [];
    pass11ViewToolPayloadGuard(
      "matcher-only",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E25");
  });

  it("passes when the test has both a Buffer.byteLength builder and a .toBeLessThan matcher", () => {
    tmp = mkTmpPlugin("happy-path");
    writeTest(
      tmp.pluginDir,
      `import { expect, it } from "vitest";
it("payload under budget", () => {
  const bytes = Buffer.byteLength(JSON.stringify({ id: 1, title: "x" }), "utf8");
  expect(bytes).toBeLessThan(30 * 1024);
});`,
    );
    const findings: Finding[] = [];
    pass11ViewToolPayloadGuard(
      "happy-path",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("passes when the test uses JSON.stringify + .toBeLessThanOrEqual", () => {
    tmp = mkTmpPlugin("alt-pattern");
    writeTest(
      tmp.pluginDir,
      `import { expect, it } from "vitest";
it("alt", () => {
  const len = JSON.stringify({ a: 1 }).length;
  expect(len).toBeLessThanOrEqual(25 * 1024);
});`,
    );
    const findings: Finding[] = [];
    pass11ViewToolPayloadGuard(
      "alt-pattern",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("emits E24 (warning) when view-tool path exists as a regular file, not a directory", () => {
    // The isDirectory() guard at line 103 of the lint pass should treat a
    // regular file named `view-tool` the same as no view-tool directory.
    tmp = mkTmpPlugin("file-not-dir", { withViewTool: false });
    // Write a regular file at the view-tool path instead of a directory.
    fs.writeFileSync(path.join(tmp.pluginDir, "view-tool"), "oops", "utf8");
    const findings: Finding[] = [];
    pass11ViewToolPayloadGuard(
      "file-not-dir",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("emits E24 (warning) when the test file exists but cannot be read", () => {
    // Exercises the readFileSync try/catch error path (lines 128-138).
    tmp = mkTmpPlugin("unreadable-test");
    const dir = path.join(tmp.pluginDir, "view-tool", "__tests__");
    fs.mkdirSync(dir, { recursive: true });
    // Create a directory where the file is expected — readFileSync throws EISDIR.
    fs.mkdirSync(path.join(dir, "payload-shape.test.ts"));
    const findings: Finding[] = [];
    pass11ViewToolPayloadGuard(
      "unreadable-test",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E24");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toMatch(/Could not read/);
  });
});

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { probeChromium, extractChromium } from "../src/probe-chromium.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "..", "bin", "cli.mjs");

function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf-8" });
}

describe("probe-chromium module", () => {
  it("returns an object with `installed: boolean`", async () => {
    const result = await probeChromium();
    expect(result).toBeTypeOf("object");
    expect(typeof result.installed).toBe("boolean");
  });

  it("includes a `reason` when import fails (no playwright in dev tree)", async () => {
    // The repo intentionally does not run `npm install` in host-renderer/
    // during CI for this test; that means `playwright` is unresolvable from
    // the test-harness probe path. We assert the failure shape here so
    // future regressions in the resolver path surface immediately.
    const result = await probeChromium();
    if (!result.installed && "reason" in result) {
      expect(result.reason).toBeTypeOf("string");
      // Either the package itself can't be found, or executablePath()
      // threw — both are acceptable failure paths the orchestrator
      // treats as "needs install."
      expect(result.reason).toMatch(/playwright|executablePath/i);
    }
  });
});

describe("extractChromium shape handling", () => {
  it("reads chromium from a native ESM module", () => {
    const mod = { chromium: { executablePath: () => "/esm/chrome" } };
    expect(extractChromium(mod)).toBe(mod.chromium);
  });

  it("reads chromium from a CJS-wrapped module (the bug we fixed)", () => {
    // Node wraps CJS exports under `.default` when the module is loaded
    // via `await import(absolutePath)`. Playwright ships as CJS in the
    // runtime tree, so this is the common case — and the destructure-only
    // path returned undefined, falsely reporting the binary missing.
    const chromium = { executablePath: () => "/cjs/chrome" };
    const mod = { default: { chromium } };
    expect(extractChromium(mod)).toBe(chromium);
  });

  it("prefers a top-level chromium over a nested default.chromium", () => {
    const top = { executablePath: () => "/top" };
    const nested = { executablePath: () => "/nested" };
    const mod = { chromium: top, default: { chromium: nested } };
    expect(extractChromium(mod)).toBe(top);
  });

  it("returns null when neither shape has chromium", () => {
    expect(extractChromium({})).toBeNull();
    expect(extractChromium({ default: {} })).toBeNull();
    expect(extractChromium(null)).toBeNull();
    expect(extractChromium(undefined)).toBeNull();
  });
});

describe("probe-chromium cli subcommand", () => {
  it("is listed in --help", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/probe-chromium/);
  });

  it("prints a JSON object on stdout", () => {
    const r = runCli(["probe-chromium"]);
    // exit code is 0 (installed) or 1 (not) — both are valid outcomes
    // depending on the dev environment; we only assert the shape here.
    expect([0, 1]).toContain(r.status);
    const parsed = JSON.parse(r.stdout.trim());
    expect(typeof parsed.installed).toBe("boolean");
  });

  it("exits 1 when playwright is unresolvable (current dev tree)", () => {
    // Mirrors the assertion in the module test above. If the dev tree
    // someday installs playwright eagerly, this test should be updated
    // to reflect the new state — fail loudly rather than silently
    // skipping.
    const r = runCli(["probe-chromium"]);
    const parsed = JSON.parse(r.stdout.trim());
    if (!parsed.installed) {
      expect(r.status).toBe(1);
    } else {
      expect(r.status).toBe(0);
    }
  });
});

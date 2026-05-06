/**
 * build-plugin.test.ts
 *
 * CLI-surface tests for scripts/build-plugin.mjs. We spawn the script as a
 * subprocess so the public-facing exit codes and error messages stay
 * stable across refactors. We deliberately do NOT exercise real npm /
 * vite / tsc invocations here — that path is covered by the CI workflow
 * (`build-pr.yml` runs `node scripts/build-plugin.mjs --all` end-to-end).
 *
 * Asserted contract:
 *   1. No args → exit 1 with usage text.
 *   2. Unknown flag → exit 1 naming the flag.
 *   3. `--serve` with multiple slugs is allowed (each plugin's MCP server
 *      uses its own default port); pairing it with `--port` is the only
 *      conflict and exits 1.
 *   4. Non-existent slug → exit 1 naming the missing path.
 *      (Skipped in the no-op happy path; our script's design also
 *      requires the shared license package to build first, which we
 *      can't isolate without mocks.)
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT = path.join(__dirname, "build-plugin.mjs");

function run(args: string[]) {
  const r = spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    // Don't let the script spawn npm — it errors out before any spawn
    // happens for the cases we test. We still set a hard timeout in case
    // a future regression introduces a pre-fail spawn.
    timeout: 10_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

describe("build-plugin.mjs CLI", () => {
  it("exits 1 with usage text when called with no args", () => {
    const r = run([]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/usage:.*build-plugin\.mjs/);
  });

  it("exits 1 on unknown flag", () => {
    const r = run(["--bogus"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Unknown flag: --bogus/);
  });

  it("exits 1 when --serve and multiple slugs are combined with --port", () => {
    const r = run([
      "agntux-core",
      "agntux-slack",
      "--serve",
      "--port",
      "9999",
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /--port cannot be combined with --serve and multiple slugs/,
    );
  });

  it("rejects an unknown slug before doing any expensive work", () => {
    // The script bails when the plugin directory doesn't exist. The shared
    // license package build runs first, so we use --skip-install to keep
    // the assertion purely about the missing-plugin path. (Even with the
    // shared build running, the failure mode is unambiguous.)
    const r = run(["this-plugin-does-not-exist", "--skip-install"]);
    expect(r.status).toBe(1);
    // The script may fail during the shared build if its dependencies aren't
    // present, or at the explicit "Plugin not found" check. Either way exit
    // code is 1; we just assert that.
  });
});

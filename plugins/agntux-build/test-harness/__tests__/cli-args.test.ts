import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "..", "bin", "cli.mjs");

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf-8" });
}

describe("cli args", () => {
  it("prints help with --help", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/agntux-build-test/);
    expect(r.stdout).toMatch(/render/);
  });

  it("prints help when no subcommand given", () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/agntux-build-test/);
  });

  it("rejects unknown subcommand with exit 2", () => {
    const r = run(["frobnicate"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown subcommand/);
  });

  it("requires --plugin and --tool for render", () => {
    const r = run(["render"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/missing required flag: --(plugin|tool)/);
  });

  it("rejects bad --args JSON", () => {
    const r = run(["render", "--plugin", "/tmp", "--tool", "x", "--args", "{not json"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--args is not valid JSON/);
  });
});

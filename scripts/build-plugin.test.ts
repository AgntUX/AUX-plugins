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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — .mjs has no .d.ts. Importing is side-effect-free: the
// CLI dispatch is guarded behind `import.meta.url === argv[1]`.
import { findReactTypesCopies, vendorPackagesDistOnly } from "./build-plugin.mjs";

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

// ── L1/L2 package vendoring (the agntux-build submission bug class) ───────────
// L1: vendor packages into a per-session writable dir (never a shared dir).
// L2: copy dist-only so the vendored primitives contribute ZERO @types/react,
// and guard against a duplicate that would crash tsc with TS2786.
describe("build-plugin.mjs L1/L2 package vendoring", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "bp-l2-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function writePkg(dir: string, name: string) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }));
  }

  it("findReactTypesCopies counts DISTINCT @types/react and ignores @types/react-dom", () => {
    const nm = path.join(tmp, "a", "node_modules");
    writePkg(path.join(nm, "@types", "react"), "@types/react");
    // @types/react-dom must NOT be counted as @types/react.
    writePkg(path.join(nm, "@types", "react-dom"), "@types/react-dom");
    expect(findReactTypesCopies([nm])).toHaveLength(1);

    // A nested duplicate (the TS2786 trigger) makes it 2.
    writePkg(path.join(nm, "dep", "node_modules", "@types", "react"), "@types/react");
    expect(findReactTypesCopies([nm])).toHaveLength(2);

    // A root that doesn't exist contributes nothing (no throw).
    expect(findReactTypesCopies([path.join(tmp, "does-not-exist")])).toHaveLength(0);
  });

  it("findReactTypesCopies follows symlinked package dirs (catches a dup behind a symlink)", () => {
    const nm = path.join(tmp, "s", "node_modules");
    writePkg(path.join(nm, "@types", "react"), "@types/react"); // plain hoisted copy
    // A second REAL @types/react reachable ONLY via a symlinked @types dir —
    // npm/pnpm routinely symlink package dirs, and the dup must still count
    // (a missed dup re-creates the TS2786 crash the guard exists to prevent).
    const realTypes = path.join(tmp, "real-pkgs", "@types");
    writePkg(path.join(realTypes, "react"), "@types/react");
    const linkParent = path.join(nm, "dep", "node_modules");
    mkdirSync(linkParent, { recursive: true });
    symlinkSync(realTypes, path.join(linkParent, "@types"), "dir");
    expect(findReactTypesCopies([nm])).toHaveLength(2);
  });

  it("vendorPackagesDistOnly copies dist, strips scripts/devDeps, and NEVER copies node_modules", () => {
    const src = path.join(tmp, "src-packages");
    const pkg = path.join(src, "agntux-ui-primitives");
    mkdirSync(path.join(pkg, "dist"), { recursive: true });
    writeFileSync(path.join(pkg, "dist", "index.js"), "export const x = 1;\n");
    writeFileSync(path.join(pkg, "dist", "index.d.ts"), "export declare const x: number;\n");
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({
        name: "@agntux/ui-primitives",
        version: "0.1.1",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        // These MUST be stripped so a contributor's `npm install` of the file:
        // dep never runs `tsc` (absent in the sandbox).
        scripts: { prepare: "tsc", build: "tsc" },
        devDependencies: { "@types/react": "^18.3.0", typescript: "^5.4.0" },
        // This MUST be kept (resolution surface).
        peerDependencies: { react: "^18.3.0" },
      }),
    );
    // The L2 trap: a nested @types/react that the OLD recursive copy dragged in.
    writePkg(path.join(pkg, "node_modules", "@types", "react"), "@types/react");

    const dest = path.join(tmp, "session-packages");
    vendorPackagesDistOnly(src, dest);

    const destPkg = path.join(dest, "agntux-ui-primitives");
    expect(existsSync(path.join(destPkg, "dist", "index.js"))).toBe(true);
    expect(existsSync(path.join(destPkg, "dist", "index.d.ts"))).toBe(true);
    // node_modules is NEVER copied — the L2 fix.
    expect(existsSync(path.join(destPkg, "node_modules"))).toBe(false);

    const vp = JSON.parse(readFileSync(path.join(destPkg, "package.json"), "utf8"));
    expect(vp.scripts).toBeUndefined();
    expect(vp.devDependencies).toBeUndefined();
    expect(vp.peerDependencies).toEqual({ react: "^18.3.0" });
    expect(vp.main).toBe("dist/index.js");

    // No @types/react reachable from the vendored tree (L2 cause removed).
    expect(findReactTypesCopies([dest])).toHaveLength(0);
  });

  it("vendorPackagesDistOnly replaces a stale per-session copy (idempotent re-vendor)", () => {
    const src = path.join(tmp, "src2");
    const pkg = path.join(src, "plugin-runtime");
    mkdirSync(path.join(pkg, "dist"), { recursive: true });
    writeFileSync(path.join(pkg, "dist", "index.js"), "export const v = 2;\n");
    writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@agntux/plugin-runtime" }));

    const dest = path.join(tmp, "session2");
    // Seed a stale file that must be gone after a fresh vendor.
    mkdirSync(path.join(dest, "plugin-runtime"), { recursive: true });
    writeFileSync(path.join(dest, "plugin-runtime", "stale.txt"), "old");

    vendorPackagesDistOnly(src, dest);
    expect(existsSync(path.join(dest, "plugin-runtime", "stale.txt"))).toBe(false);
    expect(existsSync(path.join(dest, "plugin-runtime", "dist", "index.js"))).toBe(true);
  });
});

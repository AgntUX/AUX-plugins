/**
 * launcher.test.mjs — bin/agntux-node.sh resolution + trust contract.
 *
 * The shipped launcher is what Claude Desktop's `.mcp.json` invokes (`sh
 * bin/agntux-node.sh <dist/index.js>`) on a user machine with no system Node.
 * Trust anchor: it execs a runtime ONLY if it is the genuine, codesign-verified
 * AgntUX app (Team ID K6B5DNTSS7) — the marker lives in a user-writable dir, so
 * its electronPath is untrusted.
 *
 * Security-boundary cases are deterministic (assert the look-alike was NOT
 * execed). The happy path needs a genuinely-signed binary, so it runs only when
 * /Applications/AgntUX.app is installed + signed (real integration), and is
 * skipped on a clean CI runner. The system-node fallback is forced via the
 * AGNTUX_RUNTIME_PROBE_DIRS seam so it's deterministic even on a dev box that
 * has the real app installed.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(__dirname, "..", "bin", "agntux-node.sh");

/** The real installed app exe, iff present AND signed by AgntUX's Team ID. */
function realSignedAppExe() {
  const bundle = "/Applications/AgntUX.app";
  const exe = join(bundle, "Contents", "MacOS", "AgntUX");
  if (!existsSync(exe)) return null;
  const v = spawnSync("codesign", ["--verify", "--strict", bundle], { encoding: "utf8" });
  if (v.status !== 0) return null;
  const d = spawnSync("codesign", ["-dvv", bundle], { encoding: "utf8" });
  const info = `${d.stdout || ""}${d.stderr || ""}`;
  return info.includes("TeamIdentifier=K6B5DNTSS7") ? exe : null;
}
const REAL_EXE = realSignedAppExe();

function makeHome(marker) {
  const home = mkdtempSync(join(tmpdir(), "agntux-launcher-home-"));
  if (marker) {
    const dir = join(home, "Library", "Application Support", "AgntUX");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "electron-runtime.json"), JSON.stringify(marker, null, 2));
  }
  return home;
}

/** Run the launcher with the app-bundle probe forced empty (so only the marker
 *  / system-node paths are exercised), plus optional PATH/env overrides. */
function runLauncher(home, args, { path: pathOverride } = {}) {
  const emptyProbe = mkdtempSync(join(tmpdir(), "agntux-empty-probe-"));
  const env = { ...process.env, HOME: home, AGNTUX_RUNTIME_PROBE_DIRS: emptyProbe };
  if (pathOverride) env.PATH = pathOverride;
  return spawnSync("sh", [LAUNCHER, ...args], { encoding: "utf8", env });
}

describe("agntux-node.sh launcher", () => {
  it("ships in the plugin bundle", () => {
    expect(existsSync(LAUNCHER)).toBe(true);
  });

  it("rejects a marker pointing at an UNSIGNED look-alike .app", () => {
    const home = makeHome(null);
    const fakeMacos = join(home, "Evil.app", "Contents", "MacOS");
    mkdirSync(fakeMacos, { recursive: true });
    const evil = join(fakeMacos, "Electron");
    writeFileSync(evil, "#!/bin/sh\necho SENTINEL_FAKE\n", { mode: 0o755 });
    chmodSync(evil, 0o755);
    const dir = join(home, "Library", "Application Support", "AgntUX");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "electron-runtime.json"),
      JSON.stringify({ electronPath: evil, npmCliPath: null, nodeVersion: "20.18.0" }, null, 2),
    );
    const r = runLauncher(home, ["/tmp/x.mjs"]);
    expect(r.stdout).not.toContain("SENTINEL_FAKE"); // codesign rejected it
  }, 30_000);

  it("rejects a marker pointing at an off-bundle path", () => {
    const home = makeHome(null);
    const evil = join(home, "evil");
    writeFileSync(evil, "#!/bin/sh\necho SENTINEL_FAKE\n", { mode: 0o755 });
    chmodSync(evil, 0o755);
    const dir = join(home, "Library", "Application Support", "AgntUX");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "electron-runtime.json"),
      JSON.stringify({ electronPath: evil, npmCliPath: null, nodeVersion: "20.18.0" }, null, 2),
    );
    const r = runLauncher(home, ["/tmp/x.mjs"]);
    expect(r.stdout).not.toContain("SENTINEL_FAKE");
  }, 30_000);

  it("falls back to system node when no runtime is found, leaving AGNTUX_ELECTRON unset", () => {
    const home = makeHome(null);
    // a fake `node` first on PATH proves the system-node branch was taken
    const binDir = mkdtempSync(join(tmpdir(), "agntux-fakebin-"));
    const fakeNode = join(binDir, "node");
    writeFileSync(fakeNode, '#!/bin/sh\necho "SYSNODE el=[$AGNTUX_ELECTRON]"\n', { mode: 0o755 });
    chmodSync(fakeNode, 0o755);
    const r = runLauncher(home, ["/tmp/x.mjs"], { path: `${binDir}:/usr/bin:/bin` });
    expect(r.stdout).toContain("SYSNODE");
    expect(r.stdout).toContain("el=[]"); // shim disabled → server uses system node/npm
  }, 30_000);

  it.runIf(REAL_EXE)(
    "resolves a marker to the genuine signed app and runs the script as Electron-as-Node",
    () => {
      const home = makeHome({
        schema: 1,
        electronPath: REAL_EXE,
        // a FOREIGN npm path must be dropped (not inside the verified bundle)
        npmCliPath: "/etc/evil-npm-cli.js",
        nodeVersion: "20.18.0",
      });
      const probe = join(home, "probe.mjs");
      writeFileSync(
        probe,
        'console.log("REAL el="+(process.env.AGNTUX_ELECTRON||"")+" run="+(process.env.ELECTRON_RUN_AS_NODE||"")+" npm=["+(process.env.AGNTUX_NPM_CLI||"")+"]");',
      );
      const r = runLauncher(home, [probe]);
      expect(r.stdout).toContain(`REAL el=${REAL_EXE}`);
      expect(r.stdout).toContain("run=1");
      // The FOREIGN npm path must be dropped. resolve_npm_cli then DERIVES the
      // genuine bundled npm-cli.js (sealed inside the codesign-verified app) when
      // it exists on disk — so with the real app installed AGNTUX_NPM_CLI is that
      // in-bundle path, and without a bundled npm it's empty. Either is safe; the
      // failure this guards against is the foreign /etc path being used.
      expect(r.stdout).not.toContain("/etc/evil-npm-cli.js");
      const npmVal = (r.stdout.match(/npm=\[([^\]]*)\]/) || [, ""])[1];
      const bundleNpm = join(
        dirname(dirname(dirname(REAL_EXE))),
        "Contents", "Resources", "npm", "bin", "npm-cli.js",
      );
      expect(npmVal === "" || npmVal === bundleNpm).toBe(true);
    },
    30_000,
  );
});

/**
 * runtime-shim.test.mjs — the MCP server's npm/PATH shim builder.
 *
 * On a no-system-Node machine the server runs under Electron-as-Node and must
 * make bare `node`/`npm`/`npx` resolve to that runtime so the build's run()
 * helpers (npm install → vite/tsc/vitest; npx playwright) work with no per-call
 * threading. buildRuntimeShim writes the temp shim bin dir; this pins its shape
 * + that the generated shims actually re-exec the given runtime.
 *
 * Imported from dist/index.js (the shipped artifact) — importing the module is
 * side-effect-free (initRuntimeShim()/startServer() run only as the main module).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "mcp-server", "dist", "index.js");
const { buildRuntimeShim, readRuntimeMarker, verifyAgntuxRuntime, npmUnderBundle } =
  await import(DIST);

function realSignedAppExe() {
  const bundle = "/Applications/AgntUX.app";
  const exe = join(bundle, "Contents", "MacOS", "AgntUX");
  if (!existsSync(exe)) return null;
  const v = spawnSync("codesign", ["--verify", "--strict", bundle], { encoding: "utf8" });
  if (v.status !== 0) return null;
  const d = spawnSync("codesign", ["-dvv", bundle], { encoding: "utf8" });
  return `${d.stdout || ""}${d.stderr || ""}`.includes("TeamIdentifier=K6B5DNTSS7") ? exe : null;
}
const REAL_EXE = realSignedAppExe();

/** A fake "Electron" that echoes its argv + the run-as-node flag. */
function makeFakeElectron(root) {
  const electron = join(root, "electron");
  writeFileSync(electron, `#!/bin/sh\necho "argv=$* node=$ELECTRON_RUN_AS_NODE"\n`, { mode: 0o755 });
  chmodSync(electron, 0o755);
  return electron;
}

describe("buildRuntimeShim", () => {
  it("returns null without an electron path", () => {
    expect(buildRuntimeShim({ electron: "" })).toBeNull();
    expect(buildRuntimeShim({})).toBeNull();
  });

  it("creates node/npm/npx that re-exec the runtime as Node", () => {
    const root = mkdtempSync(join(tmpdir(), "shim-test-"));
    const electron = makeFakeElectron(root);
    const npmCli = join(root, "npm-cli.js");
    writeFileSync(npmCli, "// npm\n");
    writeFileSync(join(root, "npx-cli.js"), "// npx\n");

    const built = buildRuntimeShim({ electron, npmCli, tmpRootDir: root });
    expect(built).not.toBeNull();
    expect(built.hasNpm).toBe(true);
    for (const bin of ["node", "npm", "npx"]) {
      expect(existsSync(join(built.shimDir, bin))).toBe(true);
    }
    // node shim → electron <args>
    const n = spawnSync(join(built.shimDir, "node"), ["hello"], { encoding: "utf8" });
    expect(n.stdout).toContain("argv=hello");
    expect(n.stdout).toContain("node=1");
    // npm shim → electron npm-cli.js <args>
    const m = spawnSync(join(built.shimDir, "npm"), ["install"], { encoding: "utf8" });
    expect(m.stdout).toContain("npm-cli.js install");
    expect(m.stdout).toContain("node=1");
    // npx shim → electron npx-cli.js <args>
    const x = spawnSync(join(built.shimDir, "npx"), ["playwright"], { encoding: "utf8" });
    expect(x.stdout).toContain("npx-cli.js playwright");
  }, 30_000); // generous: macOS first-run Gatekeeper scan per freshly-written exec

  it("makes only the node shim when npm is unknown", () => {
    const root = mkdtempSync(join(tmpdir(), "shim-test-"));
    const electron = makeFakeElectron(root);
    const built = buildRuntimeShim({ electron, npmCli: "", tmpRootDir: root });
    expect(built.hasNpm).toBe(false);
    expect(existsSync(join(built.shimDir, "node"))).toBe(true);
    expect(existsSync(join(built.shimDir, "npm"))).toBe(false);
    expect(existsSync(join(built.shimDir, "npx"))).toBe(false);
  });

  it("quotes runtime paths that contain spaces", () => {
    const root = mkdtempSync(join(tmpdir(), "shim test with spaces-"));
    const electron = makeFakeElectron(root);
    const built = buildRuntimeShim({ electron, tmpRootDir: root });
    const body = readFileSync(join(built.shimDir, "node"), "utf8");
    expect(body).toContain(`"${electron}"`);
    const n = spawnSync(join(built.shimDir, "node"), ["ok"], { encoding: "utf8" });
    expect(n.stdout).toContain("argv=ok");
  }, 30_000);
});

describe("readRuntimeMarker", () => {
  it("returns null when no marker exists under the given home", () => {
    const home = mkdtempSync(join(tmpdir(), "no-marker-home-"));
    expect(readRuntimeMarker(home)).toBeNull();
  });

  it("reads electronPath/npmCliPath from a present marker", () => {
    const home = mkdtempSync(join(tmpdir(), "marker-home-"));
    const electron = makeFakeElectron(home);
    const markerDir = join(home, "Library", "Application Support", "AgntUX");
    spawnSync("mkdir", ["-p", markerDir]);
    writeFileSync(
      join(markerDir, "electron-runtime.json"),
      JSON.stringify({ electronPath: electron, npmCliPath: "/x/npm-cli.js" }),
    );
    const m = readRuntimeMarker(home);
    expect(m).not.toBeNull();
    expect(m.electronPath).toBe(electron);
    expect(m.npmCliPath).toBe("/x/npm-cli.js");
  });

  it("returns null when the marker's electronPath does not exist", () => {
    const home = mkdtempSync(join(tmpdir(), "marker-home-"));
    const markerDir = join(home, "Library", "Application Support", "AgntUX");
    spawnSync("mkdir", ["-p", markerDir]);
    writeFileSync(
      join(markerDir, "electron-runtime.json"),
      JSON.stringify({ electronPath: "/does/not/exist", npmCliPath: null }),
    );
    expect(readRuntimeMarker(home)).toBeNull();
  });
});

describe("verifyAgntuxRuntime", () => {
  it("rejects a non-bundle path", () => {
    expect(verifyAgntuxRuntime("/usr/local/bin/node")).toBe(false);
    expect(verifyAgntuxRuntime("")).toBe(false);
  });

  it("rejects a nonexistent .app path", () => {
    expect(verifyAgntuxRuntime("/tmp/nope/Evil.app/Contents/MacOS/Electron")).toBe(false);
  });

  it("rejects an unsigned look-alike bundle", () => {
    const root = mkdtempSync(join(tmpdir(), "verify-test-"));
    const macos = join(root, "Evil.app", "Contents", "MacOS");
    spawnSync("mkdir", ["-p", macos]);
    const exe = join(macos, "Electron");
    writeFileSync(exe, "#!/bin/sh\necho hi\n", { mode: 0o755 });
    chmodSync(exe, 0o755);
    expect(verifyAgntuxRuntime(exe)).toBe(false); // not codesigned by AgntUX
  });

  it.runIf(REAL_EXE)("accepts the genuine signed AgntUX app", () => {
    expect(verifyAgntuxRuntime(REAL_EXE)).toBe(true);
  });
});

describe("npmUnderBundle", () => {
  it("rejects a foreign npm path (outside the verified bundle)", () => {
    const el = "/Applications/AgntUX.app/Contents/MacOS/AgntUX";
    expect(npmUnderBundle(el, "/etc/evil-npm-cli.js")).toBe("");
    expect(npmUnderBundle(el, "")).toBe("");
  });

  it("rejects an in-bundle path that does not exist on disk", () => {
    // Use a temp bundle whose npm-cli.js is never created, so the "in-bundle but
    // absent on disk → reject" branch is exercised deterministically regardless
    // of whether a real /Applications/AgntUX.app is installed on this machine
    // (hardcoding the real path made this fail once the app shipped a bundled npm).
    const root = mkdtempSync(join(tmpdir(), "npm-bundle-missing-"));
    const el = join(root, "AgntUX.app", "Contents", "MacOS", "AgntUX");
    const npmCli = join(root, "AgntUX.app", "Contents", "Resources", "npm", "bin", "npm-cli.js");
    expect(npmUnderBundle(el, npmCli)).toBe("");
  });

  it("accepts an existing npm-cli.js inside the bundle", () => {
    const root = mkdtempSync(join(tmpdir(), "npm-bundle-"));
    const el = join(root, "AgntUX.app", "Contents", "MacOS", "AgntUX");
    const npmCli = join(root, "AgntUX.app", "Contents", "Resources", "npm", "bin", "npm-cli.js");
    spawnSync("mkdir", ["-p", dirname(npmCli)]);
    writeFileSync(npmCli, "// npm\n");
    expect(npmUnderBundle(el, npmCli)).toBe(npmCli);
  });

  it("rejects a path-traversal escape from the bundle", () => {
    const el = "/Applications/AgntUX.app/Contents/MacOS/AgntUX";
    expect(
      npmUnderBundle(el, "/Applications/AgntUX.app/Contents/Resources/npm/../../../../etc/x.js"),
    ).toBe("");
  });
});

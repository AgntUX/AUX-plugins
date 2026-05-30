/**
 * launcher.test.mjs — agntux-core's bin/agntux-node.sh.
 *
 * agntux-core's MCP server (.mcp.json) and all hooks (hooks.json) invoke
 * `sh bin/agntux-node.sh <script>` so they run with zero user-installed Node.
 * The launcher is a SINGLE SOURCE (AUX-plugins/canonical/bin/agntux-node.sh):
 * this test pins agntux-core's manual copy byte-identical to BOTH the canonical
 * source AND agntux-build's synced copy, so the three cannot drift. (Build's
 * copy is also drift-guarded against canonical by the sync --check.)
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_LAUNCHER = join(__dirname, "..", "bin", "agntux-node.sh");
const BUILD_LAUNCHER = join(__dirname, "..", "..", "agntux-build", "bin", "agntux-node.sh");
const CANONICAL_LAUNCHER = join(__dirname, "..", "..", "..", "canonical", "bin", "agntux-node.sh");

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

describe("agntux-core bin/agntux-node.sh", () => {
  it("ships in the plugin bundle", () => {
    expect(existsSync(CORE_LAUNCHER)).toBe(true);
  });

  it("is byte-identical to the canonical source (single source of truth)", () => {
    expect(existsSync(CANONICAL_LAUNCHER)).toBe(true);
    expect(readFileSync(CORE_LAUNCHER, "utf8")).toBe(readFileSync(CANONICAL_LAUNCHER, "utf8"));
  });

  it("is byte-identical to agntux-build's synced copy", () => {
    expect(existsSync(BUILD_LAUNCHER)).toBe(true);
    expect(readFileSync(CORE_LAUNCHER, "utf8")).toBe(readFileSync(BUILD_LAUNCHER, "utf8"));
  });

  it.runIf(REAL_EXE)(
    "resolves a marker to the genuine signed app and runs the hook as Electron-as-Node",
    () => {
      const home = mkdtempSync(join(tmpdir(), "agntux-core-launcher-"));
      const dir = join(home, "Library", "Application Support", "AgntUX");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "electron-runtime.json"),
        JSON.stringify({ electronPath: REAL_EXE, npmCliPath: null, nodeVersion: "20.18.0" }, null, 2),
      );
      const probe = join(home, "hook.mjs");
      writeFileSync(probe, 'console.log("CORE run="+(process.env.ELECTRON_RUN_AS_NODE||""));');
      const emptyProbe = mkdtempSync(join(tmpdir(), "agntux-empty-probe-"));
      const r = spawnSync("sh", [CORE_LAUNCHER, probe], {
        encoding: "utf8",
        env: { ...process.env, HOME: home, AGNTUX_RUNTIME_PROBE_DIRS: emptyProbe },
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("CORE run=1");
    },
    30_000,
  );
});

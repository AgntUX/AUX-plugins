/**
 * agntux_report_defect writer unit tests.
 *
 * handleReportDefect is the HONEST-STOP action: when a failure is an environment/
 * internal wall (or the fix loop is exhausted), it bundles the persisted
 * validation verdict + the `.validate/*.log` tails + a best-effort tree manifest
 * into `{session_dir}/DEFECT.json` for the maintainer — and submits NOTHING. It
 * must NEVER throw and must return a structured `{ ok, ... }` result.
 *
 * Importing the server module is side-effect-free (the stdin loop is guarded
 * behind the realpath isMainModule() check), so we can call the handler directly
 * against a temp session dir. Fast + deterministic — no spawn, no build, no LLM.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — importing the server module is side-effect-free (guarded).
import { handleReportDefect } from "../mcp-server/src/index.js";

const SLUG = "agntux-testcal";

let tmpRoot: string;
let sessionDir: string;
let pluginDir: string;
let validateDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "agntux-defect-"));
  sessionDir = join(tmpRoot, ".agntux-build", "builds", "2026-01-01-000000");
  pluginDir = join(sessionDir, SLUG);
  validateDir = join(sessionDir, ".validate");

  // A minimal but real plugin tree so the best-effort tree manifest computes.
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), '{"name":"agntux-testcal","version":"0.1.0"}');
  writeFileSync(join(pluginDir, "README.md"), "# readme");
  writeFileSync(join(pluginDir, "LICENSE"), "Apache-2.0");

  // The persisted verdict + a captured stage log (what runValidation leaves on a
  // failure under .validate/).
  mkdirSync(validateDir, { recursive: true });
  writeFileSync(
    join(validateDir, "verdict.json"),
    JSON.stringify({
      ok: false,
      slug: SLUG,
      plugin_dir: pluginDir,
      failed_stage: "typecheck",
      error_kind: "plugin",
      blocking: true,
      detail: "view-tool tsc --noEmit failed",
    }),
  );
  writeFileSync(join(validateDir, "typecheck.err.log"), "view-tool/src/ui.tsx(8,9): error TS2322: bad type\n");
});

afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

describe("handleReportDefect", () => {
  it("writes DEFECT.json embedding the verdict + a log tail, and returns { ok:true, defect_path }", async () => {
    const r = await handleReportDefect({ session_dir: sessionDir, note: "tsc wall during build" });
    expect(r.ok).toBe(true);
    expect(r.defect_path).toBe(join(sessionDir, "DEFECT.json"));
    expect(existsSync(r.defect_path)).toBe(true);

    const defect = JSON.parse(readFileSync(r.defect_path, "utf8"));
    expect(defect.kind).toBe("agntux-build.defect");
    expect(defect.schema_version).toBe("1.0.0");
    expect(defect.session_dir).toBe(sessionDir);
    expect(defect.note).toBe("tsc wall during build");
    // The persisted verdict is embedded verbatim.
    expect(defect.verdict.failed_stage).toBe("typecheck");
    // The .validate/*.log tail is keyed by filename.
    expect(defect.logs["typecheck.err.log"]).toContain("TS2322");
    // The best-effort tree manifest is present (the plugin dir resolved).
    expect(defect.tree.tree_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(defect.tree.files_count).toBeGreaterThan(0);
  });

  it("returns a usage error (not a throw) when the session dir does not exist", async () => {
    const missing = join(tmpdir(), `defect-missing-${process.pid}-${Date.now()}`);
    const r = await handleReportDefect({ session_dir: missing });
    expect(r.ok).toBe(false);
    expect(r.error_kind).toBe("usage");
    expect(r.blocking).toBe(false);
    expect(typeof r.detail).toBe("string");
  });

  it("returns a usage error when session_dir is omitted", async () => {
    const r = await handleReportDefect({});
    expect(r.ok).toBe(false);
    expect(r.error_kind).toBe("usage");
  });

  it("still writes DEFECT.json (best-effort) when no .validate dir exists", async () => {
    // Remove the persisted verdict + logs; the defect bundle should still write,
    // with null verdict and empty logs — the honest-stop receipt is never blocked
    // by missing optional inputs.
    rmSync(validateDir, { recursive: true, force: true });
    const r = await handleReportDefect({ session_dir: sessionDir });
    expect(r.ok).toBe(true);
    const defect = JSON.parse(readFileSync(r.defect_path, "utf8"));
    expect(defect.verdict).toBeNull();
    expect(defect.logs).toEqual({});
    // The plugin tree still resolves via the single agntux- child fallback.
    expect(defect.tree.files_count).toBeGreaterThan(0);
  });
});

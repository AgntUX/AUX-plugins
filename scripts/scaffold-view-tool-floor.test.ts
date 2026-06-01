import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SCAFFOLD = join(__dirname, "scaffold-marketplace-assets.mjs");
const APPS_CLIENT_CANONICAL = join(
  REPO_ROOT,
  "plugins/agntux-core/view-tool/src/lib/apps-client",
);

const SLUG = "agntux-google-calendar";

/** Build a build-session-shaped tree: <session>/<slug> with a plugin.json. */
function makePluginDir(): { session: string; pluginDir: string } {
  const session = mkdtempSync(join(tmpdir(), "scaffold-vt-"));
  const pluginDir = join(session, SLUG);
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: SLUG, version: "0.1.0", recommended_ingest_cadence: "Daily 06:00" }),
  );
  return { session, pluginDir };
}

function runScaffold(pluginDir: string, withViewTool: boolean) {
  const args = [SCAFFOLD, "--slug", SLUG, "--plugin-dir", pluginDir];
  if (withViewTool) args.push("--view-tool");
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function sha256(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

describe("scaffold --view-tool floor", () => {
  let session: string;
  let pluginDir: string;
  let viewTool: string;

  beforeAll(() => {
    ({ session, pluginDir } = makePluginDir());
    viewTool = join(pluginDir, "view-tool");
    const r = runScaffold(pluginDir, true);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  afterAll(() => {
    if (session) rmSync(session, { recursive: true, force: true });
  });

  it("places package.json with the @agntux/ui-primitives + plugin-runtime deps wired", () => {
    const pkg = JSON.parse(readFileSync(join(viewTool, "package.json"), "utf8"));
    // The dep is what fixes the round-1 "Rollup failed to resolve
    // @agntux/ui-primitives" build failure — and the path is the build-session
    // layout (<plugin>/view-tool/../../packages = <session>/packages).
    expect(pkg.dependencies["@agntux/ui-primitives"]).toBe(
      "file:../../packages/agntux-ui-primitives",
    );
    expect(pkg.dependencies["@agntux/plugin-runtime"]).toBe(
      "file:../../packages/plugin-runtime",
    );
    expect(pkg.name).toBe(`@agntux-build/${SLUG}-view-tool`);
  });

  it("generates a handler-agnostic build script (loops over *.html, esbuilds {slug}-view.ts)", () => {
    const pkg = JSON.parse(readFileSync(join(viewTool, "package.json"), "utf8"));
    expect(pkg.scripts.build).toContain("for f in *.html");
    expect(pkg.scripts.build).toContain('VITE_ENTRY="${f%.html}"');
    expect(pkg.scripts.build).toContain(`esbuild src/${SLUG}-view.ts`);
    expect(pkg.scripts.build).toContain("node scripts/emit-manifest.mjs");
    // Guard: an unmatched glob (no authored view) fails with an actionable
    // message instead of an opaque Rollup "could not resolve *.html".
    expect(pkg.scripts.build).toContain('[ -e "$f" ]');
  });

  it("generates a VITE_ENTRY-driven vite.config with no hardcoded handler names", () => {
    const cfg = readFileSync(join(viewTool, "vite.config.ts"), "utf8");
    expect(cfg).toContain("process.env.VITE_ENTRY");
    expect(cfg).toContain("viteSingleFile");
    expect(cfg).toContain("tailwindcss()");
  });

  it("generates a vitest.config.ts that runs WITHOUT VITE_ENTRY (no vite.config fall-through)", () => {
    // The bug: with no vitest.config.ts present, `vitest run` loaded
    // vite.config.ts and threw "set VITE_ENTRY to the view name".
    const p = join(viewTool, "vitest.config.ts");
    expect(existsSync(p), "vitest.config.ts should be generated").toBe(true);
    const cfg = readFileSync(p, "utf8");
    // Must not READ the VITE_ENTRY env var (the bug was vitest loading
    // vite.config.ts, which throws on `process.env.VITE_ENTRY` unset). A mention
    // in an explanatory comment is fine; a `process.env.VITE_ENTRY` read is not.
    expect(cfg).not.toContain("process.env.VITE_ENTRY");
    expect(cfg).toContain('from "vitest/config"');
    expect(cfg).toContain('environment: "jsdom"');
    expect(cfg).toContain("./src/__tests__/setup.ts");
    expect(cfg).toContain("__tests__/**/*.test.{ts,tsx}");
  });

  it("generates a self-contained test setup (jest-dom + cleanup), not the template's widget matchers", () => {
    const p = join(viewTool, "src/__tests__/setup.ts");
    expect(existsSync(p), "setup.ts should be generated").toBe(true);
    const setup = readFileSync(p, "utf8");
    expect(setup).toContain("@testing-library/jest-dom/vitest");
    expect(setup).toContain("cleanup");
    // Must NOT drag in the template-only widget matchers (would reference files
    // the scaffold doesn't copy).
    expect(setup).not.toContain("setupWidgetMatchers");
  });

  it("places the E26-frozen apps-client files (simple-mcp-app, constants) identical to canonical", () => {
    // Only these two files are E26 byte-frozen vs plugins/agntux-core. The rest
    // of apps-client/** is template-sourced and intentionally not byte-checked.
    for (const name of ["simple-mcp-app.ts", "constants.ts"]) {
      const placed = join(viewTool, "src/lib/apps-client", name);
      expect(existsSync(placed), `${name} should be placed`).toBe(true);
      expect(sha256(placed), `${name} must match the E26 canonical`).toBe(
        sha256(join(APPS_CLIENT_CANONICAL, name)),
      );
    }
  });

  it("places the static build config (tsconfig, tailwind, emit-manifest, apps-react)", () => {
    for (const rel of [
      "tsconfig.json",
      "tailwind.config.mjs",
      "scripts/emit-manifest.mjs",
      "src/globals.css",
      "src/vite-env.d.ts",
      "src/lib/apps-react/index.ts",
    ]) {
      expect(existsSync(join(viewTool, rel)), `${rel} should be placed`).toBe(true);
    }
  });

  it("leaves no surviving {{placeholders}} in the generated package.json / vite.config", () => {
    for (const rel of ["package.json", "vite.config.ts"]) {
      const text = readFileSync(join(viewTool, rel), "utf8");
      expect(text.match(/\{\{[a-z-]+\}\}/), `${rel} has a surviving placeholder`).toBeNull();
    }
  });

  it("never overwrites a specialist's real file (idempotent)", () => {
    const ui = join(viewTool, "package.json");
    const sentinel = readFileSync(ui, "utf8").replace(
      /"description":\s*"[^"]*"/,
      '"description": "SPECIALIST EDIT"',
    );
    writeFileSync(ui, sentinel);
    const r = runScaffold(pluginDir, true);
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(ui, "utf8")).description).toBe("SPECIALIST EDIT");
  });
});

describe("scaffold without --view-tool", () => {
  it("does NOT create a view-tool/ tree (headless ingest plugins are unaffected)", () => {
    const { session, pluginDir } = makePluginDir();
    try {
      const r = runScaffold(pluginDir, false);
      expect(r.status, r.stderr || r.stdout).toBe(0);
      expect(existsSync(join(pluginDir, "view-tool"))).toBe(false);
    } finally {
      rmSync(session, { recursive: true, force: true });
    }
  });
});

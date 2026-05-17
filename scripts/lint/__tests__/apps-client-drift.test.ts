/**
 * apps-client-drift.test.ts
 *
 * Unit tests for pass 12 (E26/E27) — vendored apps-client byte-equality.
 *
 * Each test builds an ephemeral repo layout under os.tmpdir() that
 * mimics the real shape: a canonical copy at
 * `plugins/agntux-core/view-tool/src/lib/apps-client/`
 * and a per-plugin copy at `plugins/<slug>/view-tool/src/lib/apps-client/`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass12AppsClientDrift } from "../lint-apps-client-drift.js";
import type { Finding } from "../lint-apps-client-drift.js";

const CANONICAL_REL =
  "plugins/agntux-core/view-tool/src/lib/apps-client";

function setupRepo(): { repoRoot: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint12-"));
  const canonicalDir = path.join(repoRoot, CANONICAL_REL);
  fs.mkdirSync(canonicalDir, { recursive: true });
  fs.writeFileSync(
    path.join(canonicalDir, "simple-mcp-app.ts"),
    "// canonical SimpleMcpApp\nexport class SimpleMcpApp {}\n",
  );
  fs.writeFileSync(
    path.join(canonicalDir, "constants.ts"),
    "// canonical constants\nexport const LATEST = '2025-11-05';\n",
  );
  return { repoRoot };
}

function vendorInto(repoRoot: string, slug: string, contents?: {
  simpleMcpApp?: string;
  constants?: string;
}): { pluginDir: string } {
  const pluginDir = path.join(repoRoot, "plugins", slug);
  const vendorDir = path.join(pluginDir, "view-tool", "src", "lib", "apps-client");
  fs.mkdirSync(vendorDir, { recursive: true });
  // Default: copy canonical byte-identical.
  const canon = path.join(repoRoot, CANONICAL_REL);
  fs.writeFileSync(
    path.join(vendorDir, "simple-mcp-app.ts"),
    contents?.simpleMcpApp ?? fs.readFileSync(path.join(canon, "simple-mcp-app.ts")),
  );
  fs.writeFileSync(
    path.join(vendorDir, "constants.ts"),
    contents?.constants ?? fs.readFileSync(path.join(canon, "constants.ts")),
  );
  return { pluginDir };
}

describe("pass12AppsClientDrift", () => {
  let env: { repoRoot: string } | null = null;

  beforeEach(() => {
    env = null;
  });

  afterEach(() => {
    if (env) fs.rmSync(env.repoRoot, { recursive: true, force: true });
  });

  it("emits no finding when vendored copy is byte-identical to the canonical", () => {
    env = setupRepo();
    const { pluginDir } = vendorInto(env.repoRoot, "test-plugin");
    const findings: Finding[] = [];
    pass12AppsClientDrift("test-plugin", pluginDir, env.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("emits no finding when the plugin has no view-tool/ directory", () => {
    env = setupRepo();
    const pluginDir = path.join(env.repoRoot, "plugins", "no-view-tool-plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    const findings: Finding[] = [];
    pass12AppsClientDrift(
      "no-view-tool-plugin",
      pluginDir,
      env.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("emits E26 (error) when simple-mcp-app.ts has drifted", () => {
    env = setupRepo();
    const { pluginDir } = vendorInto(env.repoRoot, "drifted", {
      simpleMcpApp: "// DRIFTED\nexport class SimpleMcpApp { /* different */ }\n",
    });
    const findings: Finding[] = [];
    pass12AppsClientDrift("drifted", pluginDir, env.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E26");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.plugin).toBe("drifted");
    expect(findings[0]?.message).toMatch(/drift/i);
  });

  it("emits E26 when constants.ts has drifted", () => {
    env = setupRepo();
    const { pluginDir } = vendorInto(env.repoRoot, "drifted-c", {
      constants: "// DRIFTED constants\nexport const LATEST = '1999-01-01';\n",
    });
    const findings: Finding[] = [];
    pass12AppsClientDrift("drifted-c", pluginDir, env.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E26");
  });

  it("emits TWO E26 errors when both files have drifted", () => {
    env = setupRepo();
    const { pluginDir } = vendorInto(env.repoRoot, "both", {
      simpleMcpApp: "// drift\n",
      constants: "// drift\n",
    });
    const findings: Finding[] = [];
    pass12AppsClientDrift("both", pluginDir, env.repoRoot, findings);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.code === "E26")).toBe(true);
  });

  it("emits E27 (warning) when a vendored file is missing", () => {
    env = setupRepo();
    const { pluginDir } = vendorInto(env.repoRoot, "missing");
    fs.unlinkSync(
      path.join(pluginDir, "view-tool", "src", "lib", "apps-client", "constants.ts"),
    );
    const findings: Finding[] = [];
    pass12AppsClientDrift("missing", pluginDir, env.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E27");
    expect(findings[0]?.severity).toBe("warning");
  });

  it("does not emit findings against the canonical owner (agntux-core) itself", () => {
    // The canonical lives AT plugins/agntux-core/view-tool/src/lib/apps-client/
    // post-9.6.0. The plugin-local check is skipped for agntux-core so it
    // doesn't self-report a hash mismatch against itself; even if the
    // vendored copy is missing or differs, no finding is emitted for slug
    // agntux-core.
    env = setupRepo();
    // Drop a vendored copy that DOES NOT match the canonical (would be E26
    // for any other plugin) plus an agntux-core pluginDir.
    const pluginDir = path.join(env.repoRoot, "plugins", "agntux-core");
    const vendorDir = path.join(pluginDir, "view-tool", "src", "lib", "apps-client");
    fs.mkdirSync(vendorDir, { recursive: true });
    fs.writeFileSync(
      path.join(vendorDir, "simple-mcp-app.ts"),
      "// drift — but agntux-core is the owner and should be skipped\n",
    );
    fs.writeFileSync(
      path.join(vendorDir, "constants.ts"),
      "// drift\n",
    );
    const findings: Finding[] = [];
    pass12AppsClientDrift("agntux-core", pluginDir, env.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("emits no findings for rich-shape view-tool with multiple per-UI apps-client copies (all byte-equal)", () => {
    // Rich-restoration layout: view-tool/src/apps/{compose,canvas}/lib/apps-client/.
    // Pass 12's recursive scan must find BOTH and byte-equal-check each.
    env = setupRepo();
    const pluginDir = path.join(env.repoRoot, "plugins", "rich-multi");
    const canon = path.join(env.repoRoot, CANONICAL_REL);
    for (const ui of ["compose", "canvas"]) {
      const vendorDir = path.join(
        pluginDir,
        "view-tool",
        "src",
        "apps",
        ui,
        "lib",
        "apps-client",
      );
      fs.mkdirSync(vendorDir, { recursive: true });
      fs.copyFileSync(
        path.join(canon, "simple-mcp-app.ts"),
        path.join(vendorDir, "simple-mcp-app.ts"),
      );
      fs.copyFileSync(
        path.join(canon, "constants.ts"),
        path.join(vendorDir, "constants.ts"),
      );
    }
    const findings: Finding[] = [];
    pass12AppsClientDrift("rich-multi", pluginDir, env.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("emits E26 for the drifted copy when ONE of multiple per-UI apps-client copies drifts", () => {
    env = setupRepo();
    const pluginDir = path.join(env.repoRoot, "plugins", "rich-drift");
    const canon = path.join(env.repoRoot, CANONICAL_REL);
    // compose: byte-equal
    const composeDir = path.join(
      pluginDir,
      "view-tool/src/apps/compose/lib/apps-client",
    );
    fs.mkdirSync(composeDir, { recursive: true });
    fs.copyFileSync(
      path.join(canon, "simple-mcp-app.ts"),
      path.join(composeDir, "simple-mcp-app.ts"),
    );
    fs.copyFileSync(
      path.join(canon, "constants.ts"),
      path.join(composeDir, "constants.ts"),
    );
    // canvas: drifted simple-mcp-app.ts
    const canvasDir = path.join(
      pluginDir,
      "view-tool/src/apps/canvas/lib/apps-client",
    );
    fs.mkdirSync(canvasDir, { recursive: true });
    fs.writeFileSync(
      path.join(canvasDir, "simple-mcp-app.ts"),
      "// drift in canvas\n",
    );
    fs.copyFileSync(
      path.join(canon, "constants.ts"),
      path.join(canvasDir, "constants.ts"),
    );
    const findings: Finding[] = [];
    pass12AppsClientDrift("rich-drift", pluginDir, env.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E26");
    expect(findings[0]?.file).toMatch(/apps\/canvas\/lib\/apps-client/);
  });

  it("recursive scan ignores node_modules/ and dist/ apps-client trees", () => {
    // If a transitive dependency happens to have a directory named
    // `apps-client/` (e.g. ext-apps published packages, or a stale dist
    // copy), the recursive scan must NOT lint it.
    env = setupRepo();
    const pluginDir = path.join(env.repoRoot, "plugins", "with-nm-noise");
    // Real vendored copy: byte-equal.
    const realDir = path.join(pluginDir, "view-tool/src/lib/apps-client");
    fs.mkdirSync(realDir, { recursive: true });
    const canon = path.join(env.repoRoot, CANONICAL_REL);
    fs.copyFileSync(
      path.join(canon, "simple-mcp-app.ts"),
      path.join(realDir, "simple-mcp-app.ts"),
    );
    fs.copyFileSync(
      path.join(canon, "constants.ts"),
      path.join(realDir, "constants.ts"),
    );
    // Noise: a drifted apps-client tree inside node_modules/ and dist/.
    for (const trash of ["node_modules/foo/apps-client", "dist/apps-client"]) {
      const trashDir = path.join(pluginDir, "view-tool/src", trash);
      fs.mkdirSync(trashDir, { recursive: true });
      fs.writeFileSync(
        path.join(trashDir, "simple-mcp-app.ts"),
        "// drift in transitive\n",
      );
      fs.writeFileSync(
        path.join(trashDir, "constants.ts"),
        "// drift in transitive\n",
      );
    }
    const findings: Finding[] = [];
    pass12AppsClientDrift("with-nm-noise", pluginDir, env.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("checks agntux-build's canonical _template/view-tool apps-client copy", () => {
    env = setupRepo();
    // No view-tool/ at the plugin root (agntux-build doesn't ship one)
    // but EXTRA_COPIES targets the _template/view-tool path inside its
    // canonical/ subtree.
    const pluginDir = path.join(env.repoRoot, "plugins", "agntux-build");
    fs.mkdirSync(pluginDir, { recursive: true });
    const tplViewTool = path.join(
      pluginDir,
      "canonical/ui-handlers/_template/view-tool/src/lib/apps-client",
    );
    const canon = path.join(env.repoRoot, CANONICAL_REL);
    fs.mkdirSync(tplViewTool, { recursive: true });
    // Drift the copy.
    fs.writeFileSync(
      path.join(tplViewTool, "simple-mcp-app.ts"),
      "// DRIFTED canonical template\n",
    );
    fs.copyFileSync(
      path.join(canon, "constants.ts"),
      path.join(tplViewTool, "constants.ts"),
    );
    const findings: Finding[] = [];
    pass12AppsClientDrift("agntux-build", pluginDir, env.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E26");
    expect(findings[0]?.file).toMatch(/_template\/view-tool/);
  });
});

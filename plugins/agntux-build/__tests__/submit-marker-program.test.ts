/**
 * Behavioral test for the stage-12 marker program.
 *
 * 12-submit.md step (c) ships a deterministic Node program that contributors
 * run VERBATIM to write SUBMISSION.json. The skill-consistency test locks its
 * prose/literals; this test locks its *behavior*: we extract the exact fenced
 * program from the markdown, fill its placeholder constants, run it against a
 * synthetic plugin tree, and assert the marker it emits satisfies the daemon +
 * server contract. If someone edits the program into a regression (drops the
 * node_modules exclude, reorders write-before-validate, breaks the self-check),
 * this fails — the doc and its behavior cannot drift apart silently.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REF = join(
  __dirname,
  "..",
  "skills",
  "build",
  "references",
  "12-submit.md",
);

/** Extract the step-(c) program: the single ```js block that writes the marker. */
function extractMarkerProgram(): string {
  const md = readFileSync(REF, "utf8");
  const blocks = [...md.matchAll(/```js\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const program = blocks.find(
    (b) => b.includes("writeFileSync(tmp") && b.includes("tree_sha256"),
  );
  if (!program) throw new Error("could not find the step-(c) marker program in 12-submit.md");
  return program;
}

/** Fill the program's placeholder constants for a test run. */
function fillProgram(
  program: string,
  vals: { root: string; session: string; slug: string; version: string },
): string {
  return program
    .replace('"<agntux project root>"', JSON.stringify(vals.root))
    .replace('"{session-id}"', JSON.stringify(vals.session))
    .replace('"agntux-{slug}"', JSON.stringify(vals.slug))
    .replace('"{final-version}"', JSON.stringify(vals.version));
}

let tmpRoot: string;
let pluginEnvRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "agntux-marker-prog-"));
  // CLAUDE_PLUGIN_ROOT — the program reads agntux-build's own version here.
  pluginEnvRoot = join(tmpRoot, "plugin-root");
  mkdirSync(join(pluginEnvRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(pluginEnvRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "agntux-build", version: "0.13.0" }),
  );
  // contributor.json on disk.
  mkdirSync(join(tmpRoot, ".agntux-build"), { recursive: true });
  writeFileSync(
    join(tmpRoot, ".agntux-build", "contributor.json"),
    JSON.stringify({
      name: "Test User",
      email: "test@example.com",
      dco_text_version: "1.1",
      dco_agreed_at: "2026-01-01T00:00:00Z",
    }),
  );
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* swallow */
  }
});

const SESSION = "2026-01-01-000000";
const SLUG = "agntux-testcal";

function pluginDir(): string {
  return join(tmpRoot, ".agntux-build", "builds", SESSION, SLUG);
}

function writePluginTree(): void {
  const dir = pluginDir();
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), '{"name":"x"}');
  writeFileSync(join(dir, "README.md"), "# readme");
  writeFileSync(join(dir, "LICENSE"), "Apache-2.0");
  writeFileSync(join(dir, "NOTICE"), "attribution"); // must SHIP
  // Files that MUST be excluded:
  writeFileSync(join(dir, ".DS_Store"), "junk");
  mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "dep", "index.js"), "module.exports={}");
}

function run(program: string): { stdout: string; code: number; stderr: string } {
  const file = join(tmpRoot, "prog.mjs");
  writeFileSync(file, program);
  try {
    const stdout = execFileSync("node", [file], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginEnvRoot },
    });
    return { stdout, code: 0, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { stdout: err.stdout ?? "", code: err.status ?? 1, stderr: err.stderr ?? "" };
  }
}

describe("stage-12 marker program (extracted from 12-submit.md)", () => {
  it("emits a daemon/server-valid marker at the session root, excluding node_modules + cruft, shipping NOTICE", () => {
    writePluginTree();
    const program = fillProgram(extractMarkerProgram(), {
      root: tmpRoot,
      session: SESSION,
      slug: SLUG,
      version: "0.1.0",
    });
    const { stdout, code, stderr } = run(program);
    expect(code, stderr).toBe(0);

    const out = JSON.parse(stdout);
    expect(out.submission_id).toMatch(/^agntux-testcal@0\.1\.0\+[0-9a-f]{8}$/);
    expect(out.files).toBe(4); // plugin.json, README, LICENSE, NOTICE

    // Marker at the SESSION ROOT, not inside the plugin dir.
    const markerPath = join(tmpRoot, ".agntux-build", "builds", SESSION, "SUBMISSION.json");
    expect(out.marker_path).toBe(markerPath);
    expect(existsSync(join(pluginDir(), "SUBMISSION.json"))).toBe(false);

    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    expect(marker.schema_version).toBe("1.1.0");
    expect(marker.kind).toBe("agntux-build.submission");
    expect(marker.status).toBe("final");
    expect(marker.mode).toBe("create");
    expect(marker.previous_version).toBeUndefined(); // create mode
    expect(marker.agntux_build_version).toBe("0.13.0"); // from CLAUDE_PLUGIN_ROOT

    const paths = marker.files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual([
      "agntux-testcal/.claude-plugin/plugin.json",
      "agntux-testcal/LICENSE",
      "agntux-testcal/NOTICE",
      "agntux-testcal/README.md",
    ]);
    // node_modules + .DS_Store excluded:
    expect(paths.some((p: string) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p: string) => p.endsWith(".DS_Store"))).toBe(false);
    // every file carries a raw-bytes sha256 + byte count
    for (const f of marker.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof f.bytes).toBe("number");
    }
    // tree_sha256 round-trips: recompute from the manifest.
    const recomputed = createHash("sha256")
      .update(
        [...marker.files]
          .sort((a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path))
          .map((f: { path: string; sha256: string }) => `${f.path}\t${f.sha256}`)
          .join("\n"),
      )
      .digest("hex");
    expect(marker.tree_sha256).toBe(recomputed);
    expect(out.submission_id.endsWith(marker.tree_sha256.slice(0, 8))).toBe(true);
  });

  it("throws and writes NO marker when the tree has no shippable files (self-check before write)", () => {
    // Only excluded files present → files[] is empty → self-check must throw
    // BEFORE writing, leaving no marker on disk.
    const dir = pluginDir();
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "x.js"), "x");
    writeFileSync(join(dir, ".DS_Store"), "junk");

    const program = fillProgram(extractMarkerProgram(), {
      root: tmpRoot,
      session: SESSION,
      slug: SLUG,
      version: "0.1.0",
    });
    const { code, stderr } = run(program);
    expect(code).not.toBe(0);
    expect(stderr).toContain("self-check");
    const markerPath = join(tmpRoot, ".agntux-build", "builds", SESSION, "SUBMISSION.json");
    expect(existsSync(markerPath)).toBe(false); // nothing written
  });

  it("throws when contributor.json is missing required fields", () => {
    writePluginTree();
    writeFileSync(
      join(tmpRoot, ".agntux-build", "contributor.json"),
      JSON.stringify({ name: "Test User" }), // missing email + dco fields
    );
    const program = fillProgram(extractMarkerProgram(), {
      root: tmpRoot,
      session: SESSION,
      slug: SLUG,
      version: "0.1.0",
    });
    const { code, stderr } = run(program);
    expect(code).not.toBe(0);
    expect(stderr).toContain("contributor.json");
  });
});

/**
 * Marker assembly + self-check unit tests.
 *
 * This logic moved OUT of the (now-deleted) embedded program in 12-submit.md
 * and INTO the agntux-build MCP server (mcp-server/src/index.js). Importing that
 * module is side-effect-free — the stdin loop is guarded behind
 * `import.meta.url === process.argv[1]`, so the server only starts when launched
 * directly. These tests port the behavioral assertions the old
 * submit-marker-program test made (daemon/server-valid shape, node_modules +
 * cruft excluded, NOTICE shipped, tree_sha256 round-trips + matches the
 * validator's independent hasher, self-check rejects bad/mislocated markers) and
 * add the anti-fabrication assertion the whole change is for: 12-submit.md no
 * longer ships a runnable marker-writing program (the bypass surface).
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — .mjs has no .d.ts
import { computeTreeSha256, walkTree } from "../../../scripts/validate-plugin.mjs";
// @ts-expect-error — importing the server module is side-effect-free (guarded).
import {
  treeFilesAndSha,
  assembleMarker,
  markerSelfCheck,
  isValidContributor,
} from "../mcp-server/src/index.js";

const SLUG = "agntux-testcal";
const SESSION = "2026-01-01-000000";
const CONTRIB = {
  name: "Test User",
  dco_text_version: "1.1",
  dco_agreed_at: "2026-01-01T00:00:00Z",
};

let tmpRoot: string;
let sessionDir: string;
let pluginDir: string;
let markerPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "agntux-marker-"));
  sessionDir = join(tmpRoot, ".agntux-build", "builds", SESSION);
  pluginDir = join(sessionDir, SLUG);
  markerPath = join(sessionDir, "SUBMISSION.json");
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), '{"name":"x"}');
  writeFileSync(join(pluginDir, "README.md"), "# readme");
  writeFileSync(join(pluginDir, "LICENSE"), "Apache-2.0");
  writeFileSync(join(pluginDir, "NOTICE"), "attribution"); // must SHIP
  // excluded noise:
  writeFileSync(join(pluginDir, ".DS_Store"), "junk");
  mkdirSync(join(pluginDir, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(pluginDir, "node_modules", "dep", "index.js"), "module.exports={}");
});

afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

function buildOne(extra: Record<string, unknown> = {}) {
  const { files, treeSha } = treeFilesAndSha(pluginDir, SLUG, walkTree);
  const marker = assembleMarker({
    slug: SLUG,
    pluginVersion: "0.1.0",
    mode: "create",
    sessionId: SESSION,
    agntuxBuildVersion: "0.16.0",
    contrib: CONTRIB,
    treeSha,
    files,
    validation: { build: "pass", lint: "pass", tests: "pass", validate: "skipped", render: "skipped" },
    ...extra,
  });
  return { files, treeSha, marker };
}

describe("treeFilesAndSha", () => {
  it("excludes node_modules + cruft, ships NOTICE, matches computeTreeSha256", () => {
    const { files, treeSha } = treeFilesAndSha(pluginDir, SLUG, walkTree);
    const paths = files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual([
      "agntux-testcal/.claude-plugin/plugin.json",
      "agntux-testcal/LICENSE",
      "agntux-testcal/NOTICE",
      "agntux-testcal/README.md",
    ]);
    expect(paths.some((p: string) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p: string) => p.endsWith(".DS_Store"))).toBe(false);
    for (const f of files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof f.bytes).toBe("number");
    }
    // The validator's independent hasher must agree (no drift).
    expect(treeSha).toBe(computeTreeSha256(pluginDir, SLUG));
    // tree_sha256 round-trips from the manifest.
    const recomputed = createHash("sha256")
      .update(
        [...files]
          .sort((a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path))
          .map((f: { path: string; sha256: string }) => `${f.path}\t${f.sha256}`)
          .join("\n"),
      )
      .digest("hex");
    expect(treeSha).toBe(recomputed);
  });
});

describe("assembleMarker", () => {
  it("emits a daemon/server-valid create marker", () => {
    const { marker, treeSha } = buildOne();
    expect(marker.schema_version).toBe("1.1.0");
    expect(marker.kind).toBe("agntux-build.submission");
    expect(marker.status).toBe("final");
    expect(marker.mode).toBe("create");
    expect(marker.previous_version).toBeUndefined();
    expect(marker.submission_id).toBe(`agntux-testcal@0.1.0+${treeSha.slice(0, 8)}`);
    expect(marker.agntux_build_version).toBe("0.16.0");
    // Structured build provenance (optional, schema-additive): version mirrors the
    // flat field; commit/canonical_sha are reserved for differential reproduction.
    expect(marker.builder).toEqual({ version: "0.16.0" });
    expect(marker.contributor.name).toBe("Test User");
    expect(marker.contributor.email).toBeUndefined();
    expect(marker.dco.signed_off_by).toBe("Test User");
    expect(marker.tree_sha256).toBe(treeSha);
    expect(marker.validation).toEqual({
      build: "pass",
      lint: "pass",
      tests: "pass",
      validate: "skipped",
      render: "skipped",
    });
  });

  it("includes previous_version only in update mode, and revision_of when given", () => {
    const { marker } = buildOne({
      mode: "update",
      previousVersion: "0.0.9",
      revisionOf: "agntux-testcal@0.0.9+deadbeef",
    });
    expect(marker.mode).toBe("update");
    expect(marker.previous_version).toBe("0.0.9");
    expect(marker.revision_of).toBe("agntux-testcal@0.0.9+deadbeef");
  });

  it("omits socials unless the contributor provided them", () => {
    expect(buildOne().marker.contributor.socials).toBeUndefined();
    const { files, treeSha } = treeFilesAndSha(pluginDir, SLUG, walkTree);
    const withSocials = assembleMarker({
      slug: SLUG, pluginVersion: "0.1.0", mode: "create", sessionId: SESSION,
      agntuxBuildVersion: "0.16.0", contrib: { ...CONTRIB, socials: { x: "jane" } },
      treeSha, files, validation: {},
    });
    expect(withSocials.contributor.socials).toEqual({ x: "jane" });
  });

  it("omits name + email + sign-off when the contributor is anonymous", () => {
    const { files, treeSha } = treeFilesAndSha(pluginDir, SLUG, walkTree);
    const anon = assembleMarker({
      slug: SLUG, pluginVersion: "0.1.0", mode: "create", sessionId: SESSION,
      agntuxBuildVersion: "0.16.0",
      contrib: { dco_text_version: "1.1", dco_agreed_at: "2026-01-01T00:00:00Z" },
      treeSha, files, validation: {},
    });
    expect(anon.contributor.name).toBeUndefined();
    expect(anon.contributor.email).toBeUndefined();
    expect(anon.dco.signed_off_by).toBeUndefined();
  });
});

describe("isValidContributor", () => {
  it("requires only the DCO fields; name is optional and email is never required", () => {
    expect(isValidContributor(CONTRIB)).toBe(true);
    // name omitted entirely → still valid (anonymous submission)
    expect(isValidContributor({ dco_text_version: "1.1", dco_agreed_at: "2026-01-01T00:00:00Z" })).toBe(true);
    // missing DCO fields → invalid
    expect(isValidContributor({ name: "x" })).toBe(false);
    expect(isValidContributor({ ...CONTRIB, dco_agreed_at: "" })).toBe(false);
    expect(isValidContributor(null)).toBe(false);
  });
});

describe("markerSelfCheck", () => {
  it("passes a well-formed marker that is a sibling of the plugin dir", () => {
    const { marker } = buildOne();
    expect(markerSelfCheck(marker, { pluginDir, sessionDir, markerPath })).toEqual({ ok: true });
  });
  it("rejects an empty files[] (would be daemon-skipped)", () => {
    const { marker } = buildOne();
    marker.files = [];
    expect(markerSelfCheck(marker, { pluginDir, sessionDir, markerPath }).ok).toBe(false);
  });
  it("rejects a marker placed INSIDE the plugin dir (not a sibling of it)", () => {
    const { marker } = buildOne();
    const inside = join(pluginDir, "SUBMISSION.json");
    const r = markerSelfCheck(marker, { pluginDir, sessionDir, markerPath: inside });
    // The marker dir (pluginDir) is not the session dir → rejected before it
    // could be silently daemon-skipped. (The dirname guard fires first; the
    // startsWith-pluginDir branch is belt-and-suspenders for the same class.)
    expect(r.ok).toBe(false);
    expect(typeof r.detail).toBe("string");
  });
  it("rejects wrong schema kind/status", () => {
    const { marker } = buildOne();
    expect(markerSelfCheck({ ...marker, kind: "wrong" }, { pluginDir, sessionDir, markerPath }).ok).toBe(false);
    expect(markerSelfCheck({ ...marker, status: "draft" }, { pluginDir, sessionDir, markerPath }).ok).toBe(false);
  });
});

describe("anti-fabrication: 12-submit.md ships NO runnable marker program", () => {
  const ref = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "build", "references", "12-submit.md"),
    "utf8",
  );
  it("embeds no marker-writing program (the deleted bypass surface)", () => {
    const jsBlocks = [...ref.matchAll(/```js\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    const writer = jsBlocks.find((b) => b.includes("writeFileSync") && b.includes("tree_sha256"));
    expect(writer, "12-submit.md must NOT embed a marker-writing program").toBeUndefined();
  });
  it("instructs calling the write + confirm submission tools", () => {
    expect(ref).toContain("agntux_write_submission");
    expect(ref).toContain("agntux_confirm_submission");
  });
  it("keeps the hand-author prohibition", () => {
    expect(ref).toMatch(/never hand-author|do not author it by hand|don't hand-author/i);
  });
});

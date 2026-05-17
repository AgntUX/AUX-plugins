/**
 * view-tool-bundles.test.ts
 *
 * Unit tests for pass 10 (E23) — view-tool bundles must be real HTML.
 *
 * Each test builds an ephemeral plugin layout under os.tmpdir() that
 * mimics the real shape: <plugin>/view-tool/dist/ui-resources/*.html
 * — and asserts findings the way the lint runner would.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  pass10ViewToolBundles,
  pass10ViewToolBundlesInZip,
} from "../lint-view-tool-bundles.js";
import type { Finding } from "../lint-view-tool-bundles.js";

function mkTmpPlugin(slug: string): { repoRoot: string; pluginDir: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint10-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(path.join(pluginDir, "view-tool", "dist", "ui-resources"), {
    recursive: true,
  });
  return { repoRoot, pluginDir };
}

function writeBundle(pluginDir: string, name: string, body: string): void {
  fs.writeFileSync(
    path.join(pluginDir, "view-tool", "dist", "ui-resources", name),
    body,
    "utf8",
  );
}

describe("pass10ViewToolBundles", () => {
  let tmp: { repoRoot: string; pluginDir: string } | null = null;

  beforeEach(() => {
    tmp = null;
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true });
  });

  it("passes when the bundle starts with <!doctype html>", () => {
    tmp = mkTmpPlugin("good-doctype");
    writeBundle(
      tmp.pluginDir,
      "triage.html",
      `<!doctype html>\n<html><head><title>x</title></head><body><div id="root"></div><script type="module">console.log(1)</script></body></html>\n`,
    );
    const findings: Finding[] = [];
    pass10ViewToolBundles("good-doctype", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("passes when the bundle starts with <html ...>", () => {
    tmp = mkTmpPlugin("good-html");
    writeBundle(
      tmp.pluginDir,
      "view.html",
      `<html lang="en"><body><div id="root"></div></body></html>`,
    );
    const findings: Finding[] = [];
    pass10ViewToolBundles("good-html", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("tolerates a UTF-8 BOM + leading whitespace", () => {
    tmp = mkTmpPlugin("good-bom");
    writeBundle(
      tmp.pluginDir,
      "v.html",
      `﻿\n   <!doctype html>\n<html><body></body></html>`,
    );
    const findings: Finding[] = [];
    pass10ViewToolBundles("good-bom", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("flags a bundle whose body starts with `var ` (Rollup JS leak)", () => {
    tmp = mkTmpPlugin("bad-var");
    writeBundle(
      tmp.pluginDir,
      "triage.html",
      `var Bi={exports:{}},br={};function App(){return null}`,
    );
    const findings: Finding[] = [];
    pass10ViewToolBundles("bad-var", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E23");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toMatch(/JavaScript bundle/);
    expect(findings[0].message).toMatch(/Unsupported UI resource content format/);
  });

  it("flags `(function(){…})()` IIFE bundles", () => {
    tmp = mkTmpPlugin("bad-iife");
    writeBundle(tmp.pluginDir, "x.html", `(function(){console.log(1)})()`);
    const findings: Finding[] = [];
    pass10ViewToolBundles("bad-iife", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E23");
  });

  it("flags `import` / `export` module headers", () => {
    tmp = mkTmpPlugin("bad-esm");
    writeBundle(tmp.pluginDir, "x.html", `import { foo } from "./bar";`);
    const findings: Finding[] = [];
    pass10ViewToolBundles("bad-esm", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E23");
  });

  it("flags empty bundles", () => {
    tmp = mkTmpPlugin("empty");
    writeBundle(tmp.pluginDir, "x.html", ``);
    const findings: Finding[] = [];
    pass10ViewToolBundles("empty", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E23");
    expect(findings[0].message).toMatch(/is empty/);
  });

  it("is a no-op when the plugin has no view-tool/dist/ui-resources/ dir", () => {
    tmp = mkTmpPlugin("no-views");
    // wipe ui-resources dir we just made
    fs.rmSync(path.join(tmp.pluginDir, "view-tool", "dist", "ui-resources"), {
      recursive: true,
    });
    const findings: Finding[] = [];
    pass10ViewToolBundles("no-views", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("flags every bad bundle when several are shipped together", () => {
    tmp = mkTmpPlugin("multi");
    writeBundle(tmp.pluginDir, "compose.html", `<!doctype html><html></html>`);
    writeBundle(tmp.pluginDir, "canvas.html", `var x=1`);
    writeBundle(tmp.pluginDir, "broken.html", `(function(){})()`);
    const findings: Finding[] = [];
    pass10ViewToolBundles("multi", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toHaveLength(2);
    const flagged = findings.map((f) => path.basename(f.file)).sort();
    expect(flagged).toEqual(["broken.html", "canvas.html"]);
  });

  it("ignores non-.html siblings (e.g. source maps)", () => {
    tmp = mkTmpPlugin("ignore-non-html");
    writeBundle(tmp.pluginDir, "view.html", `<!doctype html><html></html>`);
    writeBundle(tmp.pluginDir, "view.html.map", `{"version":3}`);
    const findings: Finding[] = [];
    pass10ViewToolBundles(
      "ignore-non-html",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  // ── Comment-prefixed bundles (regression tests for reviewer-flagged
  //    classifier gap: terser banners and Vite HTML comments survived the
  //    previous regex). ───────────────────────────────────────────────────

  it("flags JS with a terser/uglify banner `/*! react@18 */var x=1`", () => {
    tmp = mkTmpPlugin("bad-banner");
    writeBundle(
      tmp.pluginDir,
      "x.html",
      `/*! react@18 — minified */var Bi={exports:{}};function App(){}`,
    );
    const findings: Finding[] = [];
    pass10ViewToolBundles("bad-banner", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E23");
    expect(findings[0].message).toMatch(/JavaScript bundle/);
  });

  it("flags JS with multi-line `/* license */` header followed by var", () => {
    tmp = mkTmpPlugin("bad-multiline-banner");
    writeBundle(
      tmp.pluginDir,
      "x.html",
      `/*\n * License: MIT\n * Banner spanning multiple lines\n */\nvar Bi=1;`,
    );
    const findings: Finding[] = [];
    pass10ViewToolBundles(
      "bad-multiline-banner",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E23");
  });

  it("flags JS with a `// line comment` banner before var", () => {
    tmp = mkTmpPlugin("bad-line-comment");
    writeBundle(tmp.pluginDir, "x.html", `// generated by tool\nvar x = 1;`);
    const findings: Finding[] = [];
    pass10ViewToolBundles(
      "bad-line-comment",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E23");
  });

  it("flags semicolon-prefixed IIFE `;(function(){…})()` (minifier output)", () => {
    tmp = mkTmpPlugin("bad-semi-iife");
    writeBundle(tmp.pluginDir, "x.html", `;(function(){console.log(1)})()`);
    const findings: Finding[] = [];
    pass10ViewToolBundles(
      "bad-semi-iife",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E23");
  });

  it("flags single-quote `'use strict'` headers", () => {
    tmp = mkTmpPlugin("bad-single-quote-strict");
    writeBundle(tmp.pluginDir, "x.html", `'use strict';var x=1;`);
    const findings: Finding[] = [];
    pass10ViewToolBundles(
      "bad-single-quote-strict",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E23");
  });

  it("passes legit HTML with a leading <!-- comment --> header", () => {
    tmp = mkTmpPlugin("good-html-comment");
    writeBundle(
      tmp.pluginDir,
      "view.html",
      `<!-- generated by vite-plugin-singlefile -->\n<!doctype html>\n<html><body></body></html>`,
    );
    const findings: Finding[] = [];
    pass10ViewToolBundles(
      "good-html-comment",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("passes legit HTML that starts with an inline <style> tag", () => {
    tmp = mkTmpPlugin("good-style-first");
    writeBundle(
      tmp.pluginDir,
      "view.html",
      `<style>body{margin:0}</style><div id="root"></div>`,
    );
    const findings: Finding[] = [];
    pass10ViewToolBundles(
      "good-style-first",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("flags `unknown` shaped bundles (neither HTML nor known JS opener)", () => {
    tmp = mkTmpPlugin("bad-unknown");
    // Looks like neither HTML nor a recognized JS prefix — should still
    // be rejected since the host expects real HTML.
    writeBundle(tmp.pluginDir, "x.html", `{ "json": "not html either" }`);
    const findings: Finding[] = [];
    pass10ViewToolBundles("bad-unknown", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E23");
    expect(findings[0].message).toMatch(/non-HTML content/);
  });

  it("strips leading whitespace + comment + whitespace iteratively", () => {
    // Comment-then-whitespace-then-comment chain should fully strip before
    // classification picks the body opener.
    tmp = mkTmpPlugin("good-mixed-prefix");
    writeBundle(
      tmp.pluginDir,
      "view.html",
      `   <!-- a -->\n   /* b */   <!doctype html><html></html>`,
    );
    const findings: Finding[] = [];
    pass10ViewToolBundles(
      "good-mixed-prefix",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pass10ViewToolBundlesInZip (E24)
// ---------------------------------------------------------------------------

// Build a zip under <repoRoot>/dist-zips/<name>.zip that contains the
// given map of entry-paths → bodies. The shape mirrors what
// scripts/package-plugins.mjs ships: paths are relative to the plugin
// root (e.g. `view-tool/dist/ui-resources/foo.html`).
function mkZipPlugin(slug: string): { repoRoot: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint10z-${slug}-`));
  fs.mkdirSync(path.join(repoRoot, "dist-zips"), { recursive: true });
  return { repoRoot };
}

function writeZip(
  repoRoot: string,
  zipBasename: string,
  entries: Record<string, string>,
): string {
  // Stage the entries in a temp dir, then `zip -r` them into the target.
  // Relying on the system `zip` is consistent with package-plugins.mjs.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `lint10z-stage-`));
  for (const [entryPath, body] of Object.entries(entries)) {
    const full = path.join(stage, entryPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf8");
  }
  const zipPath = path.join(repoRoot, "dist-zips", zipBasename);
  const r = spawnSync("zip", ["-rq", zipPath, "."], { cwd: stage });
  fs.rmSync(stage, { recursive: true, force: true });
  if (r.status !== 0) {
    throw new Error(`test zip authoring failed (exit ${r.status})`);
  }
  return zipPath;
}

describe("pass10ViewToolBundlesInZip", () => {
  let tmp: { repoRoot: string } | null = null;

  beforeEach(() => {
    tmp = null;
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true });
  });

  it("skips silently when dist-zips/ does not exist", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint10z-empty-`));
    tmp = { repoRoot };
    const findings: Finding[] = [];
    pass10ViewToolBundlesInZip("any-plugin", repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("skips silently when no zip matches the slug", () => {
    tmp = mkZipPlugin("other-plugin");
    writeZip(tmp.repoRoot, "unrelated-1.0.0.zip", {
      "view-tool/dist/ui-resources/foo.html": "<!doctype html><html></html>",
    });
    const findings: Finding[] = [];
    pass10ViewToolBundlesInZip("my-plugin", tmp.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("skips silently when the matching zip has no view-tool entries", () => {
    tmp = mkZipPlugin("mcp-only");
    writeZip(tmp.repoRoot, "mcp-only-1.0.0.zip", {
      ".claude-plugin/plugin.json": "{}",
      "mcp-server/dist/index.js": "console.log('hi')",
    });
    const findings: Finding[] = [];
    pass10ViewToolBundlesInZip("mcp-only", tmp.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("passes when the zipped bundle starts with <!doctype html>", () => {
    tmp = mkZipPlugin("good-zip");
    writeZip(tmp.repoRoot, "good-zip-1.0.0.zip", {
      "view-tool/dist/ui-resources/triage.html":
        "<!doctype html>\n<html><body><div id='root'></div></body></html>",
    });
    const findings: Finding[] = [];
    pass10ViewToolBundlesInZip("good-zip", tmp.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("flags E24 when the zipped bundle is a JS module renamed to .html", () => {
    tmp = mkZipPlugin("stale-zip");
    // The exact opener that triggered the user-visible regression.
    const jsBody =
      `var Bi={exports:{}},br={};` +
      `/**\n * @license React\n */` +
      "x".repeat(2048);
    writeZip(tmp.repoRoot, "stale-zip-9.5.0.zip", {
      "view-tool/dist/ui-resources/triage.html": jsBody,
    });
    const findings: Finding[] = [];
    pass10ViewToolBundlesInZip("stale-zip", tmp.repoRoot, findings);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.code).toBe("E24");
    expect(f.severity).toBe("error");
    expect(f.plugin).toBe("stale-zip");
    expect(f.file).toMatch(/dist-zips\/stale-zip-9\.5\.0\.zip$/);
    expect(f.message).toMatch(/JavaScript bundle/);
    expect(f.message).toMatch(/Unsupported UI resource content format/);
    expect(f.message).toMatch(/package-plugins\.mjs stale-zip/);
    expect(f.message).toMatch(/re-upload/);
  });

  it("flags E24 for every bad entry in a multi-bundle zip", () => {
    tmp = mkZipPlugin("multi-bad");
    writeZip(tmp.repoRoot, "multi-bad-2.0.0.zip", {
      "view-tool/dist/ui-resources/compose.html": "var x=1;",
      "view-tool/dist/ui-resources/canvas.html": "(function(){})();",
      // A real-HTML sibling — must NOT be flagged.
      "view-tool/dist/ui-resources/ok.html": "<!doctype html><html></html>",
    });
    const findings: Finding[] = [];
    pass10ViewToolBundlesInZip("multi-bad", tmp.repoRoot, findings);
    expect(findings).toHaveLength(2);
    const flagged = findings.map((f) => f.message).join("\n");
    expect(flagged).toMatch(/compose\.html/);
    expect(flagged).toMatch(/canvas\.html/);
    expect(flagged).not.toMatch(/ok\.html/);
    for (const f of findings) expect(f.code).toBe("E24");
  });

  it("flags every matching zip across multiple versioned builds", () => {
    // Same slug, two versions side-by-side in dist-zips/. Both bad.
    tmp = mkZipPlugin("dual-version");
    writeZip(tmp.repoRoot, "dual-version-1.0.0.zip", {
      "view-tool/dist/ui-resources/triage.html": "var x=1;",
    });
    writeZip(tmp.repoRoot, "dual-version-1.0.1.zip", {
      "view-tool/dist/ui-resources/triage.html": "const x=1;",
    });
    const findings: Finding[] = [];
    pass10ViewToolBundlesInZip("dual-version", tmp.repoRoot, findings);
    expect(findings).toHaveLength(2);
    const files = new Set(findings.map((f) => f.file));
    expect(files.size).toBe(2);
  });

  it("does not falsely match a different plugin whose slug is a prefix", () => {
    // `agntux-core-bonus-1.0.0.zip` must NOT be classified under
    // `agntux-core`. The slug-prefix match additionally requires that the
    // first char after `{slug}-` is a digit (start of the semver), which
    // disambiguates against a longer-slug plugin's zip.
    tmp = mkZipPlugin("prefix-collision");
    writeZip(tmp.repoRoot, "agntux-core-bonus-1.0.0.zip", {
      "view-tool/dist/ui-resources/triage.html": "var x=1;",
    });
    // Also put a real agntux-core zip alongside to prove the matcher still
    // catches the legitimate one.
    writeZip(tmp.repoRoot, "agntux-core-9.5.0.zip", {
      "view-tool/dist/ui-resources/triage.html": "<!doctype html><html></html>",
    });
    const findings: Finding[] = [];
    pass10ViewToolBundlesInZip("agntux-core", tmp.repoRoot, findings);
    // Zero findings: the bonus zip belongs to a different plugin row, and
    // the real agntux-core zip is healthy.
    expect(findings).toEqual([]);
  });
});

/**
 * view-tool-css-bundle.test.ts
 *
 * Unit tests for pass 13 (E28) — every view-tool whose source uses
 * className= must emit HTML resources with a non-empty inline <style>
 * block. See `../lint-view-tool-css-bundle.ts` for the rationale.
 *
 * Each test builds an ephemeral plugin layout under os.tmpdir() that
 * mimics the real shape: <plugin>/view-tool/{src,dist/ui-resources}/.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass13ViewToolCssBundle } from "../lint-view-tool-css-bundle.js";
import type { Finding } from "../lint-view-tool-css-bundle.js";

interface Tmp {
  repoRoot: string;
  pluginDir: string;
}

function mkTmpPlugin(slug: string): Tmp {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint13-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(path.join(pluginDir, "view-tool", "src"), { recursive: true });
  fs.mkdirSync(path.join(pluginDir, "view-tool", "dist", "ui-resources"), {
    recursive: true,
  });
  return { repoRoot, pluginDir };
}

function writeSource(tmp: Tmp, name: string, body: string): void {
  fs.writeFileSync(
    path.join(tmp.pluginDir, "view-tool", "src", name),
    body,
    "utf8",
  );
}

function writeBundle(tmp: Tmp, name: string, body: string): void {
  fs.writeFileSync(
    path.join(tmp.pluginDir, "view-tool", "dist", "ui-resources", name),
    body,
    "utf8",
  );
}

// A realistic Tailwind-built `<style>` body — has braces, colons,
// and `@` at-rules. Used as the "good" bundle body throughout.
const TAILWIND_STYLE = `<style>*,::before,::after{box-sizing:border-box}html{line-height:1.5}.p-4{padding:1rem}.text-lg{font-size:1.125rem;line-height:1.75rem}.font-semibold{font-weight:600}@media (prefers-color-scheme:dark){html{color-scheme:dark}}</style>`;

const CLASSNAME_SOURCE = `import { createRoot } from "react-dom/client";
function View() { return <div className="p-4"><h1 className="text-lg font-semibold">Hi</h1></div>; }
createRoot(document.getElementById("root")!).render(<View />);
`;

const INLINE_STYLE_SOURCE = `import { createRoot } from "react-dom/client";
function View() { return <div style={{ padding: 16 }}><h1>Hi</h1></div>; }
createRoot(document.getElementById("root")!).render(<View />);
`;

describe("pass13ViewToolCssBundle", () => {
  let tmp: Tmp | null = null;

  beforeEach(() => {
    tmp = null;
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true });
  });

  it("passes when className= source ships an HTML with a real <style> block", () => {
    tmp = mkTmpPlugin("good");
    writeSource(tmp, "triage-ui.tsx", CLASSNAME_SOURCE);
    writeBundle(
      tmp,
      "triage.html",
      `<!doctype html><html><head>${TAILWIND_STYLE}</head><body><div id="root"></div></body></html>`,
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle("good", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("flags E28 when className= source ships an HTML with NO <style> block", () => {
    tmp = mkTmpPlugin("bad");
    writeSource(tmp, "triage-ui.tsx", CLASSNAME_SOURCE);
    writeBundle(
      tmp,
      "triage.html",
      `<!doctype html><html><body><div id="root"></div><script>console.log(1)</script></body></html>`,
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle("bad", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E28");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].plugin).toBe("bad");
    expect(findings[0].message).toMatch(/no inline <style> block/);
    expect(findings[0].message).toMatch(/className=/);
    expect(findings[0].message).toMatch(/@tailwindcss\/vite/);
  });

  it("flags E28 when the <style> block is empty / whitespace-only", () => {
    tmp = mkTmpPlugin("empty-style");
    writeSource(tmp, "triage-ui.tsx", CLASSNAME_SOURCE);
    writeBundle(
      tmp,
      "triage.html",
      `<!doctype html><html><head><style>   \n\t  </style></head><body></body></html>`,
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle(
      "empty-style",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E28");
  });

  it("flags E28 when the <style> block contains only a CSS comment (regression for review finding #1)", () => {
    tmp = mkTmpPlugin("comment-only-style");
    writeSource(tmp, "triage-ui.tsx", CLASSNAME_SOURCE);
    // A `<style>/* nothing */</style>` block emits zero rules. The
    // earlier non-whitespace check would have let this pass; the
    // strip-CSS-comments-then-look-for-token check rejects it.
    writeBundle(
      tmp,
      "triage.html",
      `<!doctype html><html><head><style>/* nothing here */</style></head><body></body></html>`,
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle(
      "comment-only-style",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E28");
  });

  it("passes when <style> has a comment AND real CSS rules", () => {
    tmp = mkTmpPlugin("comment-plus-rules");
    writeSource(tmp, "triage-ui.tsx", CLASSNAME_SOURCE);
    writeBundle(
      tmp,
      "triage.html",
      `<!doctype html><html><head><style>/*! tailwind banner */.p-4{padding:1rem}</style></head><body></body></html>`,
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle(
      "comment-plus-rules",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("skips silently when source has no className= (inline-style only)", () => {
    tmp = mkTmpPlugin("inline-styles-only");
    writeSource(tmp, "compose-ui.tsx", INLINE_STYLE_SOURCE);
    writeBundle(
      tmp,
      "compose.html",
      `<!doctype html><html><body><div id="root"></div></body></html>`,
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle(
      "inline-styles-only",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("skips silently when the plugin has no view-tool/ directory", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint13-noview-`));
    const pluginDir = path.join(repoRoot, "plugins", "no-view-tool");
    fs.mkdirSync(pluginDir, { recursive: true });
    tmp = { repoRoot, pluginDir };
    const findings: Finding[] = [];
    pass13ViewToolCssBundle(
      "no-view-tool",
      pluginDir,
      repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("skips silently when view-tool/ exists but no *-ui.tsx is present", () => {
    tmp = mkTmpPlugin("no-ui-source");
    // Only a non-ui source file — should not count.
    writeSource(tmp, "helpers.ts", `export const x = 1;`);
    writeBundle(
      tmp,
      "view.html",
      `<!doctype html><html><body></body></html>`,
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle(
      "no-ui-source",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("skips silently when className= source exists but dist/ui-resources/ is absent (Pass 10 territory)", () => {
    tmp = mkTmpPlugin("no-dist");
    writeSource(tmp, "triage-ui.tsx", CLASSNAME_SOURCE);
    fs.rmSync(
      path.join(tmp.pluginDir, "view-tool", "dist", "ui-resources"),
      { recursive: true },
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle("no-dist", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("flags each bad HTML in a multi-bundle plugin and ignores the good one", () => {
    tmp = mkTmpPlugin("multi");
    writeSource(tmp, "compose-ui.tsx", CLASSNAME_SOURCE);
    writeSource(tmp, "canvas-ui.tsx", CLASSNAME_SOURCE);
    writeBundle(
      tmp,
      "compose.html",
      `<!doctype html><html><head>${TAILWIND_STYLE}</head><body></body></html>`,
    );
    writeBundle(
      tmp,
      "canvas.html",
      `<!doctype html><html><body></body></html>`, // no <style>
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle("multi", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toMatch(/canvas\.html$/);
    expect(findings[0].code).toBe("E28");
  });

  it("detects className= when only one of several *-ui.tsx entries uses it", () => {
    // Mixed plugin: one entry styles via Tailwind, the other doesn't.
    // Since ANY className= in ANY *-ui.tsx triggers the gate, every
    // emitted HTML must ship CSS — uniformity at the bundle level.
    tmp = mkTmpPlugin("mixed");
    writeSource(tmp, "compose-ui.tsx", INLINE_STYLE_SOURCE);
    writeSource(tmp, "canvas-ui.tsx", CLASSNAME_SOURCE);
    writeBundle(
      tmp,
      "compose.html",
      `<!doctype html><html><body></body></html>`,
    );
    writeBundle(
      tmp,
      "canvas.html",
      `<!doctype html><html><body></body></html>`,
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle("mixed", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toHaveLength(2);
    for (const f of findings) expect(f.code).toBe("E28");
  });

  it("tolerates <style> with attributes like type=text/css", () => {
    tmp = mkTmpPlugin("attr-style");
    writeSource(tmp, "triage-ui.tsx", CLASSNAME_SOURCE);
    writeBundle(
      tmp,
      "triage.html",
      `<!doctype html><html><head><style type="text/css" data-vite-dev-id="x">.p-4{padding:1rem}</style></head><body></body></html>`,
    );
    const findings: Finding[] = [];
    pass13ViewToolCssBundle(
      "attr-style",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });
});

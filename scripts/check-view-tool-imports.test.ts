import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — .mjs has no .d.ts
import {
  run,
  extractExportNames,
  extractJsxAttributeNames,
  scanBannedConstructs,
  stripCommentsAndStrings,
  CANONICAL_SCROLLABLE_PANEL_PROPS,
} from "./check-view-tool-imports.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGES = resolve(__dirname, "..", "packages"); // real @agntux/ui-primitives exports

const APPS_REACT_INDEX = `export { useHostStyleVariables, useToolResult, useWidgetState, useAppsClient } from "./hooks.js";\n`;

function tree() {
  const root = mkdtempSync(join(tmpdir(), "import-check-"));
  mkdirSync(join(root, "view-tool", "src", "lib", "apps-react"), { recursive: true });
  writeFileSync(join(root, "view-tool", "src", "lib", "apps-react", "index.ts"), APPS_REACT_INDEX);
  return root;
}
function writeSrc(root: string, rel: string, body: string) {
  const p = join(root, "view-tool", "src", rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}
function readSrc(root: string, rel: string) {
  return readFileSync(join(root, "view-tool", "src", rel), "utf8");
}

describe("extractExportNames", () => {
  it("collects re-export, alias, and declaration names; skips type-only", () => {
    const names = extractExportNames(
      `export { A, B as C } from "./x.js";\nexport type { T } from "./t.js";\nexport function useFoo(){}\nexport const D = 1;\n`,
    );
    expect(names.has("A")).toBe(true);
    expect(names.has("C")).toBe(true); // alias target
    expect(names.has("useFoo")).toBe(true);
    expect(names.has("D")).toBe(true);
    expect(names.has("T")).toBe(false); // type-only erased
    expect(names.has("B")).toBe(false); // original of alias not exported
  });
});

describe("check-view-tool-imports run()", () => {
  let root: string;
  beforeEach(() => {
    root = tree();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("passes a clean tree (legit ui-primitives import only)", () => {
    writeSrc(root, "App.tsx", `import { ScrollablePanel } from "@agntux/ui-primitives";\nexport const A = ScrollablePanel;\n`);
    const r = run(root, { fix: false, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    expect(r.rejects).toHaveLength(0);
    expect(r.reroutes).toHaveLength(0);
  });

  it("re-routes an apps hook off @agntux/ui-primitives to ./lib/apps-react (top-level depth)", () => {
    writeSrc(root, "App.tsx", `import { ScrollablePanel, useHostStyleVariables } from "@agntux/ui-primitives";\nexport const A = () => { useHostStyleVariables(); return ScrollablePanel; };\n`);
    const r = run(root, { fix: true, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    const after = readSrc(root, "App.tsx");
    expect(after).toContain(`from "./lib/apps-react/index.js"`);
    expect(after).toMatch(/import \{ useHostStyleVariables \} from "\.\/lib\/apps-react\/index\.js"/);
    expect(after).toMatch(/import \{ ScrollablePanel \} from "@agntux\/ui-primitives"/);
  });

  it("computes ../../ depth and MERGES into an existing apps-react import for a nested file", () => {
    writeSrc(
      root,
      "apps/compose/Compose.tsx",
      `import { useToolResult } from "../../lib/apps-react/index.js";\nimport { Spinner, useWidgetState } from "@agntux/ui-primitives";\nexport const C = () => { useToolResult(); useWidgetState(); return Spinner; };\n`,
    );
    const r = run(root, { fix: true, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    const after = readSrc(root, "apps/compose/Compose.tsx");
    // merged into the single existing apps-react import at ../../ depth
    expect(after).toMatch(/import \{ useToolResult, useWidgetState \} from "\.\.\/\.\.\/lib\/apps-react\/index\.js"/);
    expect(after).toMatch(/import \{ Spinner \} from "@agntux\/ui-primitives"/);
    // no duplicate apps-react import line
    expect(after.match(/lib\/apps-react\/index\.js/g)?.length).toBe(1);
  });

  it("renames the deprecated useStructuredContent → assertStructuredContent", () => {
    writeSrc(root, "App.tsx", `import { useStructuredContent } from "@agntux/ui-primitives";\nexport const x = useStructuredContent;\n`);
    const r = run(root, { fix: true, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    const after = readSrc(root, "App.tsx");
    expect(after).toContain("assertStructuredContent");
    expect(after).not.toContain("useStructuredContent");
  });

  it("re-routes a whole @mcp-apps-kit/ui-react import (never a view-tool dep)", () => {
    writeSrc(root, "App.tsx", `import { useToolResult } from "@mcp-apps-kit/ui-react";\nexport const x = useToolResult;\n`);
    const r = run(root, { fix: true, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    const after = readSrc(root, "App.tsx");
    expect(after).not.toContain("@mcp-apps-kit/ui-react");
    expect(after).toContain(`from "./lib/apps-react/index.js"`);
  });

  it("HARD-fails on a symbol exported by nothing and does NOT write the file", () => {
    const body = `import { ScrollablePanel, buildConnectorEnvelope } from "@agntux/ui-primitives";\nexport const x = buildConnectorEnvelope;\n`;
    writeSrc(root, "App.tsx", body);
    const r = run(root, { fix: true, packagesDir: PACKAGES });
    expect(r.ok).toBe(false);
    expect(r.rejects.some((x: { name: string }) => x.name === "buildConnectorEnvelope")).toBe(true);
    // a file with an unfixable reject is left untouched (no half-fix)
    expect(readSrc(root, "App.tsx")).toBe(body);
  });

  it("is idempotent — re-running --check after a --fix is clean", () => {
    writeSrc(root, "App.tsx", `import { ScrollablePanel, useHostStyleVariables } from "@agntux/ui-primitives";\nexport const A = () => { useHostStyleVariables(); return ScrollablePanel; };\n`);
    expect(run(root, { fix: true, packagesDir: PACKAGES }).ok).toBe(true);
    const check = run(root, { fix: false, packagesDir: PACKAGES });
    expect(check.ok).toBe(true);
    expect(check.reroutes).toHaveLength(0);
  });

  it("--check flags a wrong-source import without writing", () => {
    const body = `import { useHostStyleVariables } from "@agntux/ui-primitives";\nexport const x = useHostStyleVariables;\n`;
    writeSrc(root, "App.tsx", body);
    const r = run(root, { fix: false, packagesDir: PACKAGES });
    expect(r.ok).toBe(false); // dirty as committed
    expect(readSrc(root, "App.tsx")).toBe(body); // not written in check mode
  });

  it("preserves an inline `type` specifier — never rejects or strips it", () => {
    writeSrc(
      root,
      "App.tsx",
      `import { ScrollablePanel, type ScrollablePanelProps, useHostStyleVariables } from "@agntux/ui-primitives";\nexport const A = (_: ScrollablePanelProps) => { useHostStyleVariables(); return ScrollablePanel; };\n`,
    );
    const r = run(root, { fix: true, packagesDir: PACKAGES });
    expect(r.ok).toBe(true); // ScrollablePanelProps must NOT be a hallucination
    expect(r.rejects).toHaveLength(0);
    const after = readSrc(root, "App.tsx");
    expect(after).toMatch(/import \{ ScrollablePanel, type ScrollablePanelProps \} from "@agntux\/ui-primitives"/);
    expect(after).toContain(`useHostStyleVariables } from "./lib/apps-react/index.js"`);
  });

  it("ignores a commented-out apps-react import (no merge into the comment)", () => {
    writeSrc(
      root,
      "App.tsx",
      `// import { stale } from "./lib/apps-react/index.js";\n` +
        `import { useToolResult } from "./lib/apps-react/index.js";\n` +
        `import { Spinner, useWidgetState } from "@agntux/ui-primitives";\n` +
        `export const A = () => { useToolResult(); useWidgetState(); return Spinner; };\n`,
    );
    const r = run(root, { fix: true, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    const after = readSrc(root, "App.tsx");
    // the comment is untouched, and the re-routed hook merged into the REAL line
    expect(after).toContain(`// import { stale } from "./lib/apps-react/index.js";`);
    expect(after).toMatch(/import \{ useToolResult, useWidgetState \} from "\.\/lib\/apps-react\/index\.js"/);
    // not buried in the comment
    expect(after).not.toMatch(/\/\/ import \{ stale, useWidgetState/);
  });

  it("does not rename useStructuredContent that only appears in a comment/string", () => {
    const body = `import { ScrollablePanel } from "@agntux/ui-primitives";\n// useStructuredContent was the old name\nexport const s = "see useStructuredContent docs";\nexport const A = ScrollablePanel;\n`;
    writeSrc(root, "App.tsx", body);
    const r = run(root, { fix: true, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    expect(readSrc(root, "App.tsx")).toBe(body); // untouched — no real import of the alias
  });

  it("skips a plugin with no view-tool/src", () => {
    const empty = mkdtempSync(join(tmpdir(), "import-check-empty-"));
    const r = run(empty, { fix: true, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    rmSync(empty, { recursive: true, force: true });
  });

  it("HARD-fails on a ComponentErrorBoundary cast (the TS2786 guess-fix)", () => {
    writeSrc(
      root,
      "App.tsx",
      `import { ComponentErrorBoundary } from "@agntux/ui-primitives";\n` +
        `import type { ComponentType } from "react";\n` +
        `const EB = ComponentErrorBoundary as unknown as ComponentType<{ children: unknown }>;\n` +
        `export const A = EB;\n`,
    );
    const r = run(root, { fix: false, packagesDir: PACKAGES });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v: { kind: string }) => v.kind === "banned-cast")).toBe(true);
    // a banned construct is NEVER auto-fixed — the file is left intact
    expect(readSrc(root, "App.tsx")).toContain("ComponentErrorBoundary as");
  });

  it("HARD-fails on a hallucinated <ScrollablePanel> prop (pluginSlug)", () => {
    writeSrc(
      root,
      "App.tsx",
      `import { ScrollablePanel } from "@agntux/ui-primitives";\n` +
        `export const A = () => (\n` +
        `  <ScrollablePanel title="Hi" pluginSlug="x" footer={<div />}>\n` +
        `    <p>body</p>\n` +
        `  </ScrollablePanel>\n` +
        `);\n`,
    );
    const r = run(root, { fix: false, packagesDir: PACKAGES });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v: { name: string }) => v.name === "ScrollablePanel.pluginSlug")).toBe(true);
  });

  it("does NOT flag a banned cast that only appears in a comment or string", () => {
    // The recurring false-positive class: a contributor documenting the rule.
    const body =
      `import { ComponentErrorBoundary } from "@agntux/ui-primitives";\n` +
      `// NOTE: never write \`ComponentErrorBoundary as X\` — use it directly.\n` +
      `const HELP = "If you see TS2786, do not cast ComponentErrorBoundary as a workaround.";\n` +
      `export const A = () => <ComponentErrorBoundary><span>{HELP}</span></ComponentErrorBoundary>;\n`;
    writeSrc(root, "App.tsx", body);
    const r = run(root, { fix: false, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
    expect(readSrc(root, "App.tsx")).toBe(body); // untouched
  });

  it("passes the real multi-line nested-title <ScrollablePanel> shape", () => {
    // Mirrors the agntux-slack/gmail compose components: a JSX node as `title`
    // with its own attributes inside the `={…}` region must not leak as props.
    writeSrc(
      root,
      "App.tsx",
      `import { ScrollablePanel } from "@agntux/ui-primitives";\n` +
        `export const A = () => (\n` +
        `  <ScrollablePanel\n` +
        `    title={\n` +
        `      <span className="flex" data-testid="hdr">\n` +
        `        Compose\n` +
        `      </span>\n` +
        `    }\n` +
        `    onDismiss={() => {}}\n` +
        `    footer={<button type="button">Send</button>}\n` +
        `  >\n` +
        `    <p>body</p>\n` +
        `  </ScrollablePanel>\n` +
        `);\n`,
    );
    const r = run(root, { fix: false, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it("passes a legitimate <ScrollablePanel> with only real props", () => {
    writeSrc(
      root,
      "App.tsx",
      `import { ScrollablePanel } from "@agntux/ui-primitives";\n` +
        `export const A = () => (\n` +
        `  <ScrollablePanel title="Hi" onDismiss={() => {}} footer={<div />}>\n` +
        `    <p>body</p>\n` +
        `  </ScrollablePanel>\n` +
        `);\n`,
    );
    const r = run(root, { fix: false, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it("skips prop enforcement when the tag carries a {...spread}", () => {
    writeSrc(
      root,
      "App.tsx",
      `import { ScrollablePanel } from "@agntux/ui-primitives";\n` +
        `export const A = (props: Record<string, unknown>) => (\n` +
        `  <ScrollablePanel {...props} title="Hi">\n` +
        `    <p>body</p>\n` +
        `  </ScrollablePanel>\n` +
        `);\n`,
    );
    const r = run(root, { fix: false, packagesDir: PACKAGES });
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });
});

describe("stripCommentsAndStrings", () => {
  it("blanks comment + string bodies, preserving newlines and length", () => {
    const src = `const a = "x as y"; // ComponentErrorBoundary as z\nconst b = 2;\n`;
    const out = stripCommentsAndStrings(src);
    expect(out.length).toBe(src.length);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(/ComponentErrorBoundary\s+as/.test(out)).toBe(false);
    expect(out).toContain("const a ="); // code outside strings untouched
    expect(out).toContain("const b = 2;");
  });

  it("does not let an escaped quote end a string early", () => {
    const out = stripCommentsAndStrings(`const s = "a\\" as b"; const real = 1;`);
    expect(/\bas\b/.test(out)).toBe(false); // the ` as ` was inside the string
    expect(out).toContain("const real = 1;");
  });
});

describe("extractJsxAttributeNames", () => {
  it("collects attribute names (with offsets) and skips value regions", () => {
    const { attrs, hasSpread } = extractJsxAttributeNames(
      ` title="Hi" onDismiss={() => go(">")} footer={<div a="x" />} disabled `,
    );
    expect(attrs.map((a: { name: string }) => a.name)).toEqual([
      "title",
      "onDismiss",
      "footer",
      "disabled",
    ]);
    expect(attrs[0].offset).toBe(1); // " title…" → name starts at index 1
    expect(hasSpread).toBe(false);
  });

  it("detects a spread", () => {
    const { hasSpread } = extractJsxAttributeNames(` {...rest} title="x" `);
    expect(hasSpread).toBe(true);
  });
});

describe("scanBannedConstructs", () => {
  const props = CANONICAL_SCROLLABLE_PANEL_PROPS;
  it("flags a ComponentErrorBoundary cast with a line number", () => {
    const src = `const x = 1;\nconst EB = ComponentErrorBoundary as ComponentType<{}>;\n`;
    const v = scanBannedConstructs("/p/App.tsx", src, props);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("banned-cast");
    expect(v[0].line).toBe(2);
  });

  it("flags an unknown ScrollablePanel prop but not data-/aria-", () => {
    const src = `<ScrollablePanel title="t" pluginSlug="x" data-test="y" aria-label="z">k</ScrollablePanel>`;
    const v = scanBannedConstructs("/p/App.tsx", src, props);
    expect(v.map((x: { name: string }) => x.name)).toEqual(["ScrollablePanel.pluginSlug"]);
  });

  it("reports the unknown prop's OWN line on a multi-line tag (not the tag's open)", () => {
    const src =
      `<ScrollablePanel\n` + // line 1
      `  title="t"\n` + //       line 2
      `  bogus="y"\n` + //       line 3 ← the offending attr
      `>k</ScrollablePanel>\n`;
    const v = scanBannedConstructs("/p/App.tsx", src, props);
    expect(v).toHaveLength(1);
    expect(v[0].name).toBe("ScrollablePanel.bogus");
    expect(v[0].line).toBe(3);
  });

  it("is clean on a correct usage", () => {
    const src = `<ScrollablePanel title="t" footer={<a/>}>k</ScrollablePanel>`;
    expect(scanBannedConstructs("/p/App.tsx", src, props)).toHaveLength(0);
  });

  it("flags a type-only import of ComponentErrorBoundary (the other TS2786 cause)", () => {
    const src = `import type { ComponentErrorBoundary } from "@agntux/ui-primitives";\n`;
    const v = scanBannedConstructs("/p/App.tsx", src, props);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("banned-type-import");
    expect(v[0].line).toBe(1);
  });

  it("flags an inline `type` specifier on ComponentErrorBoundary in a mixed import", () => {
    const src = `import { ScrollablePanel, type ComponentErrorBoundary } from "@agntux/ui-primitives";\n`;
    const v = scanBannedConstructs("/p/App.tsx", src, props);
    expect(v.some((x: { kind: string }) => x.kind === "banned-type-import")).toBe(true);
  });

  it("does NOT flag a normal VALUE import of ComponentErrorBoundary", () => {
    const src =
      `import { ComponentErrorBoundary } from "@agntux/ui-primitives";\n` +
      `export const A = () => <ComponentErrorBoundary>k</ComponentErrorBoundary>;\n`;
    expect(scanBannedConstructs("/p/App.tsx", src, props)).toHaveLength(0);
  });

  it("ignores a cast / bad prop that only appears in a comment or string", () => {
    const src =
      `// ComponentErrorBoundary as X is wrong\n` +
      `const help = "pass pluginSlug? no such <ScrollablePanel> prop";\n` +
      `<ScrollablePanel title="t">k</ScrollablePanel>`;
    expect(scanBannedConstructs("/p/App.tsx", src, props)).toHaveLength(0);
  });
});

/**
 * view-tool-external-links.test.ts
 *
 * Unit tests for pass 16 (E31) — view-tool components must not navigate the
 * host via `target="_blank"`, `window.open(`, or `<a href>`. The sandbox
 * blocks all three; external links must go through `openLink()` / the shared
 * `ExternalLink` wrapper. See `../lint-view-tool-external-links.ts`.
 *
 * Semantics note: unlike pass 14 (which wants a call to EXIST, so a
 * commented-out call still counts as missing), pass 16 wants the pattern to be
 * ABSENT — so a pattern that appears ONLY inside a comment must NOT flag (the
 * scrubber removes comments). String literals ARE preserved, because the signal
 * we match (`"_blank"`) is itself a string literal.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass16ViewToolExternalLinks } from "../lint-view-tool-external-links.js";
import type { Finding } from "../lint-view-tool-external-links.js";

interface Tmp {
  repoRoot: string;
  pluginDir: string;
}

function mkTmpPlugin(slug: string): Tmp {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint16-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(path.join(pluginDir, "view-tool", "src", "components"), {
    recursive: true,
  });
  return { repoRoot, pluginDir };
}

/** Write a file under view-tool/src/<relPath>. */
function writeSrc(tmp: Tmp, relPath: string, body: string): void {
  const abs = path.join(tmp.pluginDir, "view-tool", "src", relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function run(tmp: Tmp, slug: string): Finding[] {
  const findings: Finding[] = [];
  pass16ViewToolExternalLinks(slug, tmp.pluginDir, tmp.repoRoot, findings);
  return findings;
}

const GOOD_COMPONENT = `import { ExternalLink } from "./external-link.js";
import { useAppsClient } from "../lib/apps-react/index.js";

export function Card({ url }: { url: string }) {
  const client = useAppsClient();
  return (
    <div>
      <ExternalLink href={url} className="p-0">Open</ExternalLink>
      <button onClick={() => client.openLink(url)}>Open too</button>
    </div>
  );
}
`;

// The shared ExternalLink wrapper: its ONLY <a href> mentions are inside //
// comments, so it must pass cleanly (the scrubber removes them).
const EXTERNAL_LINK_COMPONENT = `// Sandboxed iframes block <a href> navigation. ALL external links MUST use
// this component. Never render <a href="..."> for external URLs.
import { useAppsClient } from "../lib/apps-react/index.js";

export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const client = useAppsClient();
  return <button type="button" onClick={() => { void client.openLink(href); }}>{children}</button>;
}
`;

describe("pass16ViewToolExternalLinks", () => {
  let tmp: Tmp | null = null;

  beforeEach(() => {
    tmp = null;
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true });
  });

  it("passes clean components that use ExternalLink / openLink", () => {
    tmp = mkTmpPlugin("good");
    writeSrc(tmp, "components/card.tsx", GOOD_COMPONENT);
    expect(run(tmp, "good")).toEqual([]);
  });

  it("passes the shared ExternalLink wrapper (its <a href> is comment-only)", () => {
    tmp = mkTmpPlugin("wrapper");
    writeSrc(tmp, "components/external-link.tsx", EXTERNAL_LINK_COMPONENT);
    expect(run(tmp, "wrapper")).toEqual([]);
  });

  it('flags E31 (error) for target="_blank"', () => {
    tmp = mkTmpPlugin("blank");
    writeSrc(
      tmp,
      "components/card.tsx",
      `export const L = () => (\n  <a href={url} target="_blank" rel="noopener">Open</a>\n);\n`,
    );
    const findings = run(tmp, "blank");
    // Both the <a href> pattern and the target="_blank" pattern match.
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.every((f) => f.code === "E31")).toBe(true);
    expect(findings.every((f) => f.severity === "error")).toBe(true);
    expect(findings.some((f) => f.line === 2)).toBe(true);
  });

  it("flags E31 for window.open(", () => {
    tmp = mkTmpPlugin("winopen");
    writeSrc(
      tmp,
      "components/card.tsx",
      `export function go(url: string) {\n  window.open(url, "_blank");\n}\n`,
    );
    const findings = run(tmp, "winopen");
    expect(findings.some((f) => f.code === "E31" && f.line === 2)).toBe(true);
  });

  it("flags E31 for a bare <a href> even without target=_blank", () => {
    tmp = mkTmpPlugin("anchor");
    writeSrc(
      tmp,
      "components/card.tsx",
      `export const L = () => <a href={sig.href} className="x">{sig.label}</a>;\n`,
    );
    const findings = run(tmp, "anchor");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E31");
  });

  it("does NOT flag patterns that appear only inside a // line comment", () => {
    tmp = mkTmpPlugin("linecomment");
    writeSrc(
      tmp,
      "components/card.tsx",
      `// avoid <a href> and target="_blank" and window.open( here\nexport const L = () => <span>ok</span>;\n`,
    );
    expect(run(tmp, "linecomment")).toEqual([]);
  });

  it("does NOT flag patterns that appear only inside a /* block comment */", () => {
    tmp = mkTmpPlugin("blockcomment");
    writeSrc(
      tmp,
      "components/card.tsx",
      `/*\n * Never use <a href target="_blank"> or window.open(.\n */\nexport const L = () => <span>ok</span>;\n`,
    );
    expect(run(tmp, "blockcomment")).toEqual([]);
  });

  it("recurses into nested app/component dirs and reports relative paths", () => {
    tmp = mkTmpPlugin("nested");
    writeSrc(
      tmp,
      "apps/compose/components/thing.tsx",
      `export const T = () => <a href={u} target="_blank">x</a>;\n`,
    );
    const findings = run(tmp, "nested");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]?.file).toContain(
      path.join("view-tool", "src", "apps", "compose", "components", "thing.tsx"),
    );
  });

  it("ignores lib/ (vendored apps-client) and __tests__/", () => {
    tmp = mkTmpPlugin("excluded");
    writeSrc(
      tmp,
      "lib/apps-client/adapters/mcp.ts",
      `export const x = () => window.open("https://x");\n`,
    );
    writeSrc(
      tmp,
      "__tests__/card.test.tsx",
      `it("x", () => { render(<a href={u} target="_blank">x</a>); });\n`,
    );
    expect(run(tmp, "excluded")).toEqual([]);
  });

  it("stays silent when the plugin has no view-tool/src/ directory", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint16-nodir-"));
    const pluginDir = path.join(repoRoot, "plugins", "no-view");
    fs.mkdirSync(pluginDir, { recursive: true });
    tmp = { repoRoot, pluginDir };
    expect(run(tmp, "no-view")).toEqual([]);
  });
});

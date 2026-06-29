/**
 * view-tool-local-str.test.ts
 *
 * Unit tests for pass 23 (E38) — a view-tool must not re-author a local
 * `str()`/`strArr()` coercer; it must import the shared accessors from
 * `lib/payload.js`. See `../lint-view-tool-local-str.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass23ViewToolLocalStr } from "../lint-view-tool-local-str.js";
import type { Finding } from "../lint-view-tool-local-str.js";

interface Tmp {
  repoRoot: string;
  pluginDir: string;
}

function mkTmpPlugin(slug: string): Tmp {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint23-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(path.join(pluginDir, "view-tool", "src", "components"), {
    recursive: true,
  });
  return { repoRoot, pluginDir };
}

function writeSrc(tmp: Tmp, relPath: string, body: string): void {
  const abs = path.join(tmp.pluginDir, "view-tool", "src", relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function run(tmp: Tmp, slug: string): Finding[] {
  const findings: Finding[] = [];
  pass23ViewToolLocalStr(slug, tmp.pluginDir, tmp.repoRoot, findings);
  return findings;
}

describe("pass23ViewToolLocalStr", () => {
  let tmp: Tmp | null = null;
  beforeEach(() => { tmp = null; });
  afterEach(() => { if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true }); });

  it("flags E38 (warning) for a re-authored `function str(`", () => {
    tmp = mkTmpPlugin("agntux-posthog");
    writeSrc(
      tmp,
      "agntux-posthog-view.ts",
      `function str(v: unknown): string {\n  return typeof v === "string" ? v : "";\n}\n`,
    );
    const findings = run(tmp, "agntux-posthog");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E38");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.line).toBe(1);
    expect(findings[0]?.message).toContain("idStr");
  });

  it("flags a `const str =` arrow and a `function strArr(`", () => {
    tmp = mkTmpPlugin("agntux-x");
    writeSrc(tmp, "a-ui.tsx", `const str = (v: unknown): string => (typeof v === "string" ? v : "");\n`);
    writeSrc(tmp, "components/b.tsx", `export function strArr(v: unknown): string[] { return []; }\n`);
    const findings = run(tmp, "agntux-x");
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.code === "E38")).toBe(true);
  });

  it("does NOT flag `idStr` (a different identifier)", () => {
    tmp = mkTmpPlugin("agntux-x");
    writeSrc(tmp, "view.ts", `function idStr(v: unknown): string { return typeof v === "string" ? v : ""; }\n`);
    expect(run(tmp, "agntux-x")).toHaveLength(0);
  });

  it("does NOT flag a call site `const title = str(v)`", () => {
    tmp = mkTmpPlugin("agntux-x");
    writeSrc(
      tmp,
      "view.ts",
      `import { str } from "./lib/payload.js";\nconst title = str(parsed.title);\nconst body = str(parsed.body);\n`,
    );
    expect(run(tmp, "agntux-x")).toHaveLength(0);
  });

  it("does NOT flag `str` appearing only in a comment", () => {
    tmp = mkTmpPlugin("agntux-x");
    writeSrc(tmp, "view.ts", `// never re-author a local function str() here\nconst x = 1;\n`);
    expect(run(tmp, "agntux-x")).toHaveLength(0);
  });

  it("does NOT flag the accessor module under lib/ that legitimately defines str", () => {
    tmp = mkTmpPlugin("agntux-x");
    writeSrc(tmp, "lib/payload.ts", `export function str(v: unknown): string { return typeof v === "string" ? v : ""; }\n`);
    expect(run(tmp, "agntux-x")).toHaveLength(0);
  });

  it("does NOT flag a plugin without a view-tool/src", () => {
    tmp = mkTmpPlugin("agntux-x");
    fs.rmSync(path.join(tmp.pluginDir, "view-tool"), { recursive: true, force: true });
    expect(run(tmp, "agntux-x")).toHaveLength(0);
  });
});

/**
 * view-tool-response-envelope.test.ts
 *
 * Unit tests for pass 14 (E29) — every view-tool source MUST call
 * `renderConfirmationText(…)` so the handler ships a `content[]` block
 * alongside `structuredContent`. See `../lint-view-tool-response-envelope.ts`
 * for the rationale and the production-bug lineage.
 *
 * Each test builds an ephemeral plugin layout under os.tmpdir() that
 * mimics the real shape: <plugin>/view-tool/src/<slug>-view.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass14ViewToolResponseEnvelope } from "../lint-view-tool-response-envelope.js";
import type { Finding } from "../lint-view-tool-response-envelope.js";

interface Tmp {
  repoRoot: string;
  pluginDir: string;
}

function mkTmpPlugin(slug: string): Tmp {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint14-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(path.join(pluginDir, "view-tool", "src"), { recursive: true });
  return { repoRoot, pluginDir };
}

function writeView(tmp: Tmp, name: string, body: string): void {
  fs.writeFileSync(
    path.join(tmp.pluginDir, "view-tool", "src", name),
    body,
    "utf8",
  );
}

const GOOD_VIEW = `import { renderConfirmationText } from "@agntux/plugin-runtime";

const LABEL = "Demo view";

export async function handle() {
  return {
    content: [{ type: "text", text: renderConfirmationText(LABEL) }],
    structuredContent: { ok: true },
  };
}
`;

// Imports the helper but never calls it — the import alone is not
// enough; the handler must actually invoke it. Pass 14 requires the
// open-paren to differentiate import from call.
const IMPORT_ONLY_VIEW = `import { renderConfirmationText } from "@agntux/plugin-runtime";

export async function handle() {
  return {
    structuredContent: { ok: true },
  };
}
`;

const MISSING_VIEW = `export async function handle() {
  return { structuredContent: { ok: true } };
}
`;

describe("pass14ViewToolResponseEnvelope", () => {
  let tmp: Tmp | null = null;

  beforeEach(() => {
    tmp = null;
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true });
  });

  it("passes when the view-tool source calls renderConfirmationText(…)", () => {
    tmp = mkTmpPlugin("good");
    writeView(tmp, "good-view.ts", GOOD_VIEW);
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope("good", tmp.pluginDir, tmp.repoRoot, findings);
    expect(findings).toEqual([]);
  });

  it("flags E29 when the helper is imported but never called", () => {
    tmp = mkTmpPlugin("import-only");
    writeView(tmp, "import-only-view.ts", IMPORT_ONLY_VIEW);
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope(
      "import-only",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E29");
    expect(findings[0]?.severity).toBe("warning");
  });

  it("flags E29 when the helper is absent entirely", () => {
    tmp = mkTmpPlugin("missing");
    writeView(tmp, "missing-view.ts", MISSING_VIEW);
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope(
      "missing",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E29");
    expect(findings[0]?.message).toMatch(/renderConfirmationText/);
  });

  it("flags E29 once per offending file in a multi-view plugin", () => {
    tmp = mkTmpPlugin("multi");
    writeView(tmp, "a-view.ts", GOOD_VIEW);
    writeView(tmp, "b-view.ts", MISSING_VIEW);
    writeView(tmp, "c-view.ts", MISSING_VIEW);
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope(
      "multi",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.code).toBe("E29");
      expect(f.severity).toBe("warning");
    }
  });

  it("stays silent when the plugin has no view-tool/src/ directory", () => {
    // Use mkdtemp directly so we get a tmp dir without view-tool/.
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint14-nodir-"));
    const pluginDir = path.join(repoRoot, "plugins", "no-view");
    fs.mkdirSync(pluginDir, { recursive: true });
    tmp = { repoRoot, pluginDir };
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope(
      "no-view",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("stays silent when view-tool/src/ exists but has no *-view.ts entries", () => {
    tmp = mkTmpPlugin("empty-src");
    // Other source files (e.g. *-ui.tsx) but no *-view.ts.
    writeView(tmp, "thing-ui.tsx", "// ui file\n");
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope(
      "empty-src",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("ignores *.d.ts type declarations", () => {
    tmp = mkTmpPlugin("with-dts");
    writeView(tmp, "view-tools.d.ts", "export type Foo = number;\n");
    writeView(tmp, "real-view.ts", GOOD_VIEW);
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope(
      "with-dts",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });

  it("flags E29 when the call appears only inside a // line comment", () => {
    // Regression guard for the false-negative class flagged in the
    // post-implementation review — `// renderConfirmationText(LABEL)`
    // satisfied the naive grep before the scrubber landed.
    tmp = mkTmpPlugin("comment-only");
    writeView(
      tmp,
      "comment-only-view.ts",
      `// renderConfirmationText(LABEL) — TODO wire up\nexport async function handle() { return { structuredContent: {} }; }\n`,
    );
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope(
      "comment-only",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E29");
  });

  it("flags E29 when the call appears only inside a /* block comment */", () => {
    tmp = mkTmpPlugin("block-comment");
    writeView(
      tmp,
      "block-comment-view.ts",
      `/*\n * Example: renderConfirmationText(LABEL)\n */\nexport async function handle() { return { structuredContent: {} }; }\n`,
    );
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope(
      "block-comment",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E29");
  });

  it("flags E29 when the call appears only inside a string literal", () => {
    tmp = mkTmpPlugin("string-literal");
    writeView(
      tmp,
      "string-literal-view.ts",
      `const note = "call renderConfirmationText(LABEL) here";\nexport async function handle() { return { structuredContent: { note } }; }\n`,
    );
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope(
      "string-literal",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E29");
  });

  it("passes when the call spans multiple lines (newline between name and paren)", () => {
    // The grep matches `renderConfirmationText\s*\(`, so a wrapped
    // call should still satisfy the lint. Documenting that here
    // pins the behavior.
    tmp = mkTmpPlugin("multiline");
    writeView(
      tmp,
      "multiline-view.ts",
      `import { renderConfirmationText } from "@agntux/plugin-runtime";\nconst LABEL = "Demo";\nexport async function handle() {\n  return {\n    content: [{ type: "text", text: renderConfirmationText\n      (LABEL) }],\n    structuredContent: {},\n  };\n}\n`,
    );
    const findings: Finding[] = [];
    pass14ViewToolResponseEnvelope(
      "multiline",
      tmp.pluginDir,
      tmp.repoRoot,
      findings,
    );
    expect(findings).toEqual([]);
  });
});

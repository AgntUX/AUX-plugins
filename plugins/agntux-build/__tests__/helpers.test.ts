/**
 * Error-capture + feedback helper unit tests — the pure functions in
 * scripts/validate-plugin.mjs that turn raw compiler/linter/test output into the
 * structured `{ failed_file, failed_line, error_code, ... }` the MCP server
 * threads into every verdict, classify a failure as a fixable plugin defect vs.
 * an environment wall, and synthesize the plain-English summary/next_action.
 *
 * These are the rich-error-feedback surface the whole change is for: the model
 * gets a named file/line and an honest stop-or-fix instruction instead of a wall
 * of log text it would otherwise hand-emulate around. Fast + deterministic — no
 * spawn, no build, no LLM.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs has no .d.ts
import { parseFirstError, classifyFailure, buildSummary, tail } from "../../../scripts/validate-plugin.mjs";

describe("parseFirstError", () => {
  it("parses a tsc diagnostic (file(line,col): error TSxxxx: msg)", () => {
    const out = "view-tool/src/ui.tsx(42,9): error TS2322: Type 'string' is not assignable to type 'number'.";
    expect(parseFirstError(out)).toEqual({
      failed_file: "view-tool/src/ui.tsx",
      failed_line: 42,
      failed_col: 9,
      error_code: "TS2322",
      error_message: "Type 'string' is not assignable to type 'number'.",
    });
  });

  it("parses the esbuild/vite ✘ [ERROR] + indented locator form", () => {
    const out = [
      '✘ [ERROR] Could not resolve "./missing"',
      "",
      "    src/app.tsx:3:18:",
      "      3 │ import x from \"./missing\";",
    ].join("\n");
    expect(parseFirstError(out)).toEqual({
      failed_file: "src/app.tsx",
      failed_line: 3,
      failed_col: 18,
      error_message: 'Could not resolve "./missing"',
    });
  });

  it("parses the plain esbuild/vite file:line:col: ERROR: msg form", () => {
    const out = "view-tool/src/compose-ui.tsx:8:10: ERROR: Unexpected end of file";
    expect(parseFirstError(out)).toEqual({
      failed_file: "view-tool/src/compose-ui.tsx",
      failed_line: 8,
      failed_col: 10,
      error_message: "Unexpected end of file",
    });
  });

  it("parses an eslint block (file path line, then LINE:COL error msg rule)", () => {
    const out = [
      "src/index.ts",
      "  12:7  error  Unexpected console statement  no-console",
      "  20:1  error  Missing semicolon  semi",
    ].join("\n");
    expect(parseFirstError(out)).toEqual({
      failed_file: "src/index.ts",
      failed_line: 12,
      failed_col: 7,
      error_message: "Unexpected console statement",
      error_code: "no-console",
    });
  });

  it("parses a vitest failure (FAIL path + ❯ locator + AssertionError)", () => {
    const out = [
      " FAIL  __tests__/foo.test.ts > widget > renders",
      "AssertionError: expected 1 to be 2 // Object.is equality",
      " ❯ __tests__/foo.test.ts:42:13",
    ].join("\n");
    expect(parseFirstError(out)).toEqual({
      failed_file: "__tests__/foo.test.ts",
      failed_line: 42,
      failed_col: 13,
      error_message: "expected 1 to be 2 // Object.is equality",
    });
  });

  it("prefers the tsc match when multiple forms are present (priority order)", () => {
    // A tsc diagnostic AND a vitest locator in the same blob — tsc wins.
    const out = [
      "src/a.ts(1,1): error TS1005: ';' expected.",
      " ❯ __tests__/b.test.ts:9:9",
    ].join("\n");
    const r = parseFirstError(out);
    expect(r.error_code).toBe("TS1005");
    expect(r.failed_file).toBe("src/a.ts");
  });

  it("returns {} when nothing matches, and on empty/null/undefined input", () => {
    expect(parseFirstError("just some unstructured noise")).toEqual({});
    expect(parseFirstError("")).toEqual({});
    expect(parseFirstError(null)).toEqual({});
    expect(parseFirstError(undefined)).toEqual({});
  });
});

describe("classifyFailure", () => {
  // Each of these signals must route to a NON-blocking environment stop (not a
  // plugin defect the orchestrator would re-dispatch a specialist to "fix").
  const envSignals: [string, string][] = [
    ["EPERM", "EPERM: operation not permitted, mkdir '/usr/x'"],
    ["EACCES", "Error: EACCES: permission denied, open '/etc/x'"],
    ["ENOSPC", "ENOSPC: no space left on device"],
    ["ETIMEDOUT", "connect ETIMEDOUT 1.2.3.4:443"],
    ["ENOTFOUND", "getaddrinfo ENOTFOUND registry.npmjs.org"],
    ["getaddrinfo", "Error: getaddrinfo EAI_AGAIN registry.npmjs.org"],
    ["registry", "npm ERR! network request to https://registry.npmjs.org failed"],
    ["self-signed", "Error: self-signed certificate in certificate chain"],
    ["proxy", "Error: ERR_PROXY_CONNECTION_FAILED"],
    ["browserType.launch", "browserType.launch: Executable doesn't exist at /path"],
    ["playwright install", "Run: npx playwright install to download the browser"],
  ];
  for (const [label, text] of envSignals) {
    it(`classifies "${label}" as a non-blocking environment failure`, () => {
      expect(classifyFailure("build", { stderr: text })).toEqual({
        error_kind: "environment",
        blocking: false,
      });
    });
  }

  it("classifies a plain tsc compile error as a blocking plugin defect", () => {
    expect(
      classifyFailure("typecheck", { stderr: "src/x.ts(1,1): error TS2322: bad type" }),
    ).toEqual({ error_kind: "plugin", blocking: true });
  });

  it("defaults to a blocking plugin defect with no output", () => {
    expect(classifyFailure("build", {})).toEqual({ error_kind: "plugin", blocking: true });
    expect(classifyFailure("build")).toEqual({ error_kind: "plugin", blocking: true });
  });

  it("scans stdout too (signal in stdout, clean stderr)", () => {
    expect(
      classifyFailure("tests", { stdout: "npm ERR! ENOSPC: no space left", stderr: "" }),
    ).toEqual({ error_kind: "environment", blocking: false });
  });
});

describe("buildSummary", () => {
  it("plugin failure names the file/line and routes to the specialist", () => {
    const { summary, next_action } = buildSummary({
      tool: "validate",
      ok: false,
      error_kind: "plugin",
      blocking: true,
      failed_stage: "typecheck",
      failed_file: "view-tool/src/ui.tsx",
      failed_line: 8,
      error_code: "TS2322",
      routing: "view-tool-builder",
    });
    expect(summary).toContain("typecheck");
    expect(summary).toContain("TS2322");
    expect(summary).toContain("view-tool/src/ui.tsx:8");
    expect(next_action).toContain("view-tool-builder");
  });

  it("environment failure uses honest-stop wording (report defect, no re-dispatch)", () => {
    const { summary, next_action } = buildSummary({
      tool: "validate",
      ok: false,
      error_kind: "environment",
      blocking: false,
      failed_stage: "build",
    });
    expect(summary).toMatch(/environment limit/i);
    expect(summary).not.toMatch(/plugin defect.*\bis\b/i); // explicitly "not a plugin defect"
    expect(next_action).toContain("agntux_report_defect");
    expect(next_action).toMatch(/do not re-dispatch/i);
  });

  it("validate success says all checks passed and points to write submission", () => {
    const { summary, next_action } = buildSummary({ tool: "validate", ok: true });
    expect(summary).toMatch(/all checks passed/i);
    expect(next_action).toMatch(/write the submission/i);
  });

  it("write_submission success reflects the queued flag", () => {
    expect(buildSummary({ tool: "write_submission", ok: true, queued: true }).summary).toMatch(/queued/i);
    expect(buildSummary({ tool: "write_submission", ok: true, queued: false }).summary).toMatch(/written/i);
  });

  it("falls back to a reason when no error_code is present (confirm-style failure)", () => {
    const { summary } = buildSummary({
      tool: "confirm_submission",
      ok: false,
      error_kind: "plugin",
      reason: "daemon_inactive",
    });
    expect(summary).toContain("daemon_inactive");
  });

  it("never throws on an empty argument object", () => {
    expect(() => buildSummary({})).not.toThrow();
    const r = buildSummary({});
    expect(typeof r.summary).toBe("string");
    expect(typeof r.next_action).toBe("string");
  });
});

describe("tail", () => {
  it("returns the last n chars when the string is longer than n", () => {
    expect(tail("abcdefghij", 4)).toBe("ghij");
  });
  it("returns the whole string when it is shorter than n", () => {
    expect(tail("hi", 100)).toBe("hi");
  });
  it("coerces null/undefined to an empty string (never throws)", () => {
    expect(tail(null)).toBe("");
    expect(tail(undefined)).toBe("");
  });
  it("defaults to a 6144-char bound", () => {
    const big = "x".repeat(7000);
    expect(tail(big).length).toBe(6144);
  });
});

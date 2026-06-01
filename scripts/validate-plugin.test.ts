import { describe, it, expect } from "vitest";
import {
  parseConsoleErrors,
  buildStageResults,
  buildSummary,
  routeFromLintCode,
  parseLintFindings,
  lintArgsFor,
  // @ts-expect-error — .mjs has no .d.ts
} from "./validate-plugin.mjs";
// The CLI-side printer + cap, imported to prove the printer↔parser contract
// (a format change on one side without the other must fail a test).
import {
  capConsoleErrors,
  formatConsoleErrorLine,
  // @ts-expect-error — .mjs has no .d.ts
} from "../plugins/agntux-build/test-harness/src/console-error-format.mjs";

// These tests lock the render-feedback fix: the renderer captures the real
// console-error text, the CLI prints it as `  console error: <text>  @ <loc>`,
// and validate-plugin parses it back into the verdict so the model sees WHAT
// broke instead of just a count. Pure-function level — no browser needed.

describe("parseConsoleErrors", () => {
  it("extracts the message TEXT (not just a count) and every entry", () => {
    const out = [
      "[FAIL] schedule_view  state=tool-result  consoleErrors=2  content=0p/0f/1s  args=empty  → /tmp/x.png",
      "  console error: Cannot read properties of undefined (reading 'call')  @ blob:host.html:12:9",
      "  console error: Warning: setState during render  @ blob:host.html:48:3",
    ].join("\n");
    const r = parseConsoleErrors(out);
    expect(r.error_message).toBe(
      "Cannot read properties of undefined (reading 'call')",
    );
    expect(r.console_errors).toHaveLength(2);
    expect(r.console_errors[0]).toContain("@ blob:host.html:12:9");
  });

  it("handles a console error with no location suffix", () => {
    const r = parseConsoleErrors("  console error: boom happened\n");
    expect(r.error_message).toBe("boom happened");
    expect(r.console_errors).toEqual(["boom happened"]);
  });

  it("returns {} when there are no console-error lines", () => {
    expect(parseConsoleErrors("[PASS] view  consoleErrors=0\n")).toEqual({});
    expect(parseConsoleErrors("")).toEqual({});
    expect(parseConsoleErrors(null)).toEqual({});
  });

  it("does NOT truncate a message that legitimately ends in ` @ <path>` (no CLI loc)", () => {
    // A pageerror with no location → cli.mjs appends NO ` @ url:line:col`
    // suffix, so the trailing ` @ /etc/app.conf` is real message text and must
    // survive (only a genuine `  @ url:line:col` suffix is stripped).
    const r = parseConsoleErrors("  console error: config error @ /etc/app.conf\n");
    expect(r.error_message).toBe("config error @ /etc/app.conf");
  });

  it("caps at a loose backstop (20), looser than the CLI's own cap of 5", () => {
    const out = Array.from(
      { length: 25 },
      (_, i) => `  console error: e${i}`,
    ).join("\n");
    expect(parseConsoleErrors(out).console_errors).toHaveLength(20);
  });
});

describe("printer↔parser round-trip (console-error-format ↔ parseConsoleErrors)", () => {
  it("recovers the message text through cap → format → parse", () => {
    // Driver-shaped raw console errors (Playwright location + a location-less
    // pageerror), exactly what the host-renderer returns.
    const raw = [
      {
        type: "error",
        text: "Cannot read properties of undefined (reading 'call')",
        location: { url: "blob:host.html", lineNumber: 12, columnNumber: 9 },
      },
      { type: "pageerror", text: "boom @ /etc/x" }, // no location
    ];
    const out = capConsoleErrors(raw).map(formatConsoleErrorLine).join("\n");
    const parsed = parseConsoleErrors(out);
    expect(parsed.error_message).toBe(
      "Cannot read properties of undefined (reading 'call')",
    );
    expect(parsed.console_errors).toHaveLength(2);
    // the location-less entry's trailing ` @ /etc/x` is preserved (no strip)
    expect(parsed.console_errors[1]).toBe("boom @ /etc/x");
  });

  it("collapses a multi-line stack to a single parseable record", () => {
    const raw = [{ type: "pageerror", text: "Error: x\n    at A\n    at B" }];
    const out = capConsoleErrors(raw).map(formatConsoleErrorLine).join("\n");
    const parsed = parseConsoleErrors(out);
    expect(parsed.console_errors).toHaveLength(1);
    expect(parsed.console_errors[0]).toContain("Error: x ⏎ at A ⏎ at B");
  });

  it("marks truncation when a message exceeds the 500-char cap", () => {
    const raw = [{ type: "error", text: "z".repeat(600) }];
    const [capped] = capConsoleErrors(raw);
    expect(capped.text.endsWith("…[truncated]")).toBe(true);
  });
});

describe("buildStageResults — render console_errors passthrough", () => {
  it("surfaces error_message AND console_errors on the render stage entry", () => {
    const stages = { render: { status: "fail", detail: "rendered with 1 console error(s)" } };
    const stops = [
      {
        stage: "render",
        detail: "view tool x rendered with 1 console error(s)",
        routing: "view-tool-builder",
        blocking: true,
        errorKind: "plugin",
        error_message: "Cannot read properties of undefined (reading 'call')",
        console_errors: ["Cannot read properties of undefined (reading 'call') @ blob:host.html:12:9"],
        stderr_tail: "",
      },
    ];
    const out = buildStageResults(stages, stops, ["render"]);
    const render = out.find((s) => s.stage === "render");
    expect(render?.status).toBe("fail");
    expect(render?.errors[0].error_message).toBe(
      "Cannot read properties of undefined (reading 'call')",
    );
    expect(render?.errors[0].console_errors).toEqual([
      "Cannot read properties of undefined (reading 'call') @ blob:host.html:12:9",
    ]);
    expect(render?.errors[0].routing).toBe("view-tool-builder");
  });

  it("a passing stage carries an empty errors[] (no console_errors leakage)", () => {
    const out = buildStageResults({ render: { status: "pass" } }, [], ["render"]);
    expect(out[0].errors).toEqual([]);
  });
});

describe("buildSummary — usage/internal envelopes no longer mislabel as 'compile error'", () => {
  it("a usage error names the bad call, not a build-stage compile error", () => {
    const { summary, next_action } = buildSummary({
      tool: "scaffold",
      ok: false,
      error_kind: "usage",
      detail: "plugin dir not found: /x/agntux-foo",
    });
    expect(summary).toContain("scaffold: invalid call");
    expect(summary).toContain("plugin dir not found");
    expect(summary).not.toContain("compile error");
    expect(summary).not.toContain("build stage");
    expect(next_action).toMatch(/do not re-dispatch a specialist/i);
  });

  it("an internal tooling error routes to report-defect, not a specialist", () => {
    const { summary, next_action } = buildSummary({
      tool: "scaffold",
      ok: false,
      error_kind: "internal",
      detail: "could not create plugin dir /x: EACCES",
    });
    expect(summary).toContain("agntux-build tooling error");
    expect(summary).not.toContain("compile error");
    expect(next_action).toMatch(/report_defect/i);
  });

  it("still labels a real plugin compile failure as a build-stage failure", () => {
    const { summary } = buildSummary({
      tool: "validate",
      ok: false,
      error_kind: "plugin",
      failed_stage: "build",
      error_code: "TS2786",
      failed_file: "src/x-ui.tsx",
      failed_line: 34,
    });
    expect(summary).toContain("build stage");
    expect(summary).toContain("TS2786");
  });

  it("collapses a multi-line detail to a single line", () => {
    const { summary } = buildSummary({
      tool: "scaffold",
      ok: false,
      error_kind: "usage",
      detail: "first line\nsecond line\nthird",
    });
    expect(summary).toContain("first line");
    expect(summary).not.toContain("second line");
  });
});

describe("routeFromLintCode — per-code specialist ownership", () => {
  it("listing/manifest codes → manifest-author", () => {
    for (const c of ["E05", "E11", "E04", "E14", "E01", "E02"]) {
      expect(routeFromLintCode(c)).toBe("manifest-author");
    }
  });
  it("skill-render drift E15 → ingest-prompt-author", () => {
    expect(routeFromLintCode("E15")).toBe("ingest-prompt-author");
  });
  it("view-tool passes + BUILD-* → view-tool-builder", () => {
    for (const c of ["E13", "E23", "E24", "E25", "E26", "E27", "E28", "BUILD-css"]) {
      expect(routeFromLintCode(c)).toBe("view-tool-builder");
    }
  });
  it("an unknown/empty code defaults to manifest-author", () => {
    expect(routeFromLintCode("")).toBe("manifest-author");
    expect(routeFromLintCode(undefined)).toBe("manifest-author");
  });
});

describe("lintArgsFor — the lint stage MUST request --json", () => {
  const tc = {
    canonicalRoot: "/repo",
    appsClientCanonicalRoot: "/repo",
    tmpRoot: "/tmp",
  };
  it("always includes --json (without it, parseLintFindings gets nothing)", () => {
    const args = lintArgsFor("agntux-foo", "/p/agntux-foo", tc);
    // The load-bearing flag — the whole per-finding punch-list depends on it.
    expect(args).toContain("--json");
  });
  it("passes the plugin slug, the plugin dir, and the canonical roots", () => {
    const args = lintArgsFor("agntux-foo", "/p/agntux-foo", tc);
    expect(args).toEqual([
      "--plugin", "agntux-foo",
      "--plugin-dir", "/p/agntux-foo",
      "--canonical-root", "/repo",
      "--apps-client-canonical-root", "/repo",
      "--tmp-root", "/tmp",
      "--json",
    ]);
  });
});

describe("parseLintFindings — JSONL with non-JSON noise", () => {
  it("parses finding objects and skips banner/log lines", () => {
    const stdout = [
      "> lint:marketplace", // npm banner — skipped
      '{"code":"E05","severity":"error","file":"marketplace/listing.yaml","line":7,"message":"unknown field"}',
      "random log line", // skipped
      '{"code":"E15","severity":"error","file":"skills/x/SKILL.md","message":"surviving placeholder"}',
    ].join("\n");
    const f = parseLintFindings(stdout);
    expect(f).toHaveLength(2);
    expect(f.map((x: { code: string }) => x.code)).toEqual(["E05", "E15"]);
  });
  it("returns [] on empty/null", () => {
    expect(parseLintFindings("")).toEqual([]);
    expect(parseLintFindings(null)).toEqual([]);
  });
});

describe("buildStageResults — lint multi-owner punch-list (E05 + E15 reach BOTH owners)", () => {
  it("surfaces lint_findings + routings so the orchestrator dispatches every owner", () => {
    const stages = { lint: { status: "fail", detail: "marketplace lint failed" } };
    const stops = [
      {
        stage: "lint",
        detail:
          "marketplace lint failed for agntux-foo (codes: E05,E15) — dispatch each: manifest-author, ingest-prompt-author",
        routing: "ingest-prompt-author",
        routings: ["manifest-author", "ingest-prompt-author"],
        lint_findings: [
          { code: "E05", severity: "error", file: "marketplace/listing.yaml", line: 7, message: "unknown field", routing: "manifest-author" },
          { code: "E15", severity: "error", file: "skills/foo/SKILL.md", message: "surviving placeholder", routing: "ingest-prompt-author" },
        ],
        blocking: true,
        errorKind: "plugin",
      },
    ];
    const out = buildStageResults(stages, stops, ["lint"]);
    const lint = out.find((s: { stage: string }) => s.stage === "lint");
    expect(lint?.errors[0].routings).toEqual([
      "manifest-author",
      "ingest-prompt-author",
    ]);
    expect(lint?.errors[0].lint_findings).toHaveLength(2);
    expect(lint?.errors[0].lint_findings[0].routing).toBe("manifest-author");
    expect(lint?.errors[0].lint_findings[1].routing).toBe("ingest-prompt-author");
  });
});

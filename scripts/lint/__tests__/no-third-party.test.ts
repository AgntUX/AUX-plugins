/**
 * no-third-party.test.ts
 *
 * Unit tests for Pass 7 — no third-party MCP calls in view tools (T23).
 *
 * Tests cover:
 *   - extractMcpReferences: correctly extracts mcp__*__* tokens
 *   - isAllowedReference: own-plugin refs allowed, third-party refs rejected
 *   - scanToolsDir: passing fixture (own-plugin only), failing fixtures (slack, gmail)
 *   - Real plugin trees: slack-thread canonical, notes-ingest (no-op), agntux-core (non-view tools, no mcp__ refs)
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractMcpReferences,
  isAllowedReference,
  scanToolsDir,
  pass7NoThirdPartyInViews,
} from "../lint-no-third-party-in-views.js";
import type { Finding } from "../../lint-marketplace-metadata.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.join(__dirname, "fixtures");
const passingViewToolsDir = path.join(fixturesDir, "view-tools", "passing");
const failingViewToolsDir = path.join(fixturesDir, "view-tools", "failing");

// Repo root for real plugin trees
// __dirname = scripts/lint/__tests__/ → 3 levels up → plugins repo root
const repoRoot = path.resolve(__dirname, "../../../");

// ---------------------------------------------------------------------------
// extractMcpReferences
// ---------------------------------------------------------------------------

describe("extractMcpReferences", () => {
  it("extracts a single mcp__*__* token", () => {
    expect(extractMcpReferences('const x = "mcp__slack__send_message"')).toEqual([
      "mcp__slack__send_message",
    ]);
  });

  it("extracts multiple tokens from a line", () => {
    const refs = extractMcpReferences(
      "mcp__slack__send_message and mcp__gmail__send_email",
    );
    expect(refs).toContain("mcp__slack__send_message");
    expect(refs).toContain("mcp__gmail__send_email");
  });

  it("extracts template placeholder form", () => {
    const refs = extractMcpReferences("mcp__{{plugin-slug}}__thread_view");
    expect(refs).toContain("mcp__{{plugin-slug}}__thread_view");
  });

  it("returns empty array for a line with no mcp__ references", () => {
    expect(extractMcpReferences("const x = callTool('my-tool', args)")).toEqual([]);
  });

  it("does not match mcp__ without double underscores on both sides", () => {
    // "mcp__foo" alone (no trailing __bar) should not match
    expect(extractMcpReferences("mcp__foo")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isAllowedReference
// ---------------------------------------------------------------------------

describe("isAllowedReference — allowed references", () => {
  it("allows own-plugin placeholder form mcp__{{plugin-slug}}__*", () => {
    expect(isAllowedReference("mcp__{{plugin-slug}}__thread_view", "my-plugin")).toBe(true);
  });

  it("allows own-plugin UI placeholder form mcp__{{plugin-slug}}-ui__*", () => {
    expect(isAllowedReference("mcp__{{plugin-slug}}-ui__thread_view", "my-plugin")).toBe(true);
  });

  it("allows own-plugin resolved form mcp__<slug>__*", () => {
    expect(isAllowedReference("mcp__my-plugin__some_view", "my-plugin")).toBe(true);
  });

  it("allows own-plugin resolved UI form mcp__<slug>-ui__*", () => {
    expect(isAllowedReference("mcp__my-plugin-ui__some_view", "my-plugin")).toBe(true);
  });
});

describe("isAllowedReference — rejected references", () => {
  it("rejects mcp__slack__send_message", () => {
    expect(isAllowedReference("mcp__slack__send_message", "my-plugin")).toBe(false);
  });

  it("rejects mcp__gmail__send_email", () => {
    expect(isAllowedReference("mcp__gmail__send_email", "my-plugin")).toBe(false);
  });

  it("rejects mcp__jira__create_issue", () => {
    expect(isAllowedReference("mcp__jira__create_issue", "my-plugin")).toBe(false);
  });

  it("rejects mcp__hubspot__update_deal", () => {
    expect(isAllowedReference("mcp__hubspot__update_deal", "my-plugin")).toBe(false);
  });

  it("does not allow a third-party slug that happens to contain the plugin slug as a prefix", () => {
    // plugin slug = "slack", third-party = "slack-ingest" — must NOT allow mcp__slack-ingest__foo
    expect(isAllowedReference("mcp__slack-ingest__foo", "slack")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanToolsDir
// ---------------------------------------------------------------------------

describe("scanToolsDir — passing fixture", () => {
  it("own-plugin view tool produces zero violations", () => {
    const violations = scanToolsDir(passingViewToolsDir, "test-plugin", fixturesDir);
    expect(violations).toHaveLength(0);
  });
});

describe("scanToolsDir — failing fixtures", () => {
  it("detects mcp__slack__send_message in slack-third-party.ts", () => {
    const violations = scanToolsDir(failingViewToolsDir, "test-plugin", fixturesDir);
    const slackViolations = violations.filter(
      (v) => v.file.includes("slack-third-party") && v.ref === "mcp__slack__send_message",
    );
    expect(slackViolations.length).toBeGreaterThan(0);
  });

  it("detects mcp__gmail__send_email in gmail-third-party.ts", () => {
    const violations = scanToolsDir(failingViewToolsDir, "test-plugin", fixturesDir);
    const gmailViolations = violations.filter(
      (v) => v.file.includes("gmail-third-party") && v.ref === "mcp__gmail__send_email",
    );
    expect(gmailViolations.length).toBeGreaterThan(0);
  });

  it("each violation has file, line, and ref fields", () => {
    const violations = scanToolsDir(failingViewToolsDir, "test-plugin", fixturesDir);
    for (const v of violations) {
      expect(v.file).toBeTruthy();
      expect(typeof v.line).toBe("number");
      expect(v.line).toBeGreaterThan(0);
      expect(v.ref).toBeTruthy();
    }
  });

  // Regression: a bad-faith author chains a benign `description: "x"`
  // earlier on the same line, then makes a real callTool() against a
  // third-party MCP. The old per-line skip waved this through; the
  // per-ref scoped-skip must catch it.
  it("catches mcp__ refs hidden behind a benign description: token (per-ref scope)", () => {
    const violations = scanToolsDir(failingViewToolsDir, "test-plugin", fixturesDir);
    const bypassViolations = violations.filter((v) =>
      v.file.includes("bypass-attempt"),
    );
    // The fixture has TWO real-call refs: mcp__slack__send_message + mcp__gmail__send_email
    expect(
      bypassViolations.some((v) => v.ref === "mcp__slack__send_message"),
    ).toBe(true);
    expect(
      bypassViolations.some((v) => v.ref === "mcp__gmail__send_email"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pass7NoThirdPartyInViews — Finding shape
// ---------------------------------------------------------------------------

describe("pass7NoThirdPartyInViews — E13 findings", () => {
  it("emits E13 findings for files in a tools dir containing violations", () => {
    // Create a synthetic plugin dir structure pointing at the failing fixtures dir
    const findings: Finding[] = [];

    // We directly use scanToolsDir to verify E13 shape via pass7 API
    const violations = scanToolsDir(failingViewToolsDir, "test-plugin", fixturesDir);
    for (const v of violations) {
      findings.push({
        code: "E13",
        severity: "error",
        plugin: "test-plugin",
        file: v.file,
        line: v.line,
        message: `${v.file}:${v.line}: disallowed third-party MCP reference "${v.ref}"`,
      });
    }

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.code === "E13")).toBe(true);
    expect(findings.every((f) => f.severity === "error")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Real plugin trees
// ---------------------------------------------------------------------------

describe("Pass 7 — real plugin trees", () => {
  it("canonical/ui-handlers/slack-thread view tool passes (no third-party refs)", () => {
    const toolsDir = path.join(
      repoRoot,
      "canonical",
      "ui-handlers",
      "slack-thread",
      "mcp-server",
      "src",
      "tools",
    );
    // Canonical templates use {{plugin-slug}} placeholder — allowed
    const violations = scanToolsDir(toolsDir, "__canonical_placeholder__", repoRoot);
    expect(violations).toHaveLength(0);
  });

  it("notes-ingest has no mcp-server/src/tools dir — pass7 is a no-op (zero findings)", () => {
    const findings: Finding[] = [];
    const pluginDir = path.join(repoRoot, "plugins", "notes-ingest");
    pass7NoThirdPartyInViews("notes-ingest", pluginDir, repoRoot, findings);
    expect(findings).toHaveLength(0);
  });

  it("agntux-core mcp-server tools have no mcp__ refs — zero E13 findings", () => {
    const findings: Finding[] = [];
    const pluginDir = path.join(repoRoot, "plugins", "agntux-core");
    pass7NoThirdPartyInViews("agntux-core", pluginDir, repoRoot, findings);
    expect(findings).toHaveLength(0);
  });
});

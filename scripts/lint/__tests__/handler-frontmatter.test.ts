/**
 * handler-frontmatter.test.ts
 *
 * Unit tests for Pass 6 — operational frontmatter validation (T23).
 *
 * Tests cover:
 *   - Passing fixture: full valid handler (mirrors T22 slack-thread.md)
 *   - Stub handler with no operational block → W03 warning
 *   - Failing fixtures: each missing a required field
 *   - Bad view_tool regex
 *   - Bad resource_uri prefix
 *   - Real plugin trees: slack-thread canonical, notes-ingest (no-op), agntux-core (stubs → W03 only)
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateHandlerFile,
  pass6HandlerFrontmatter,
  extractFrontmatter,
} from "../lint-handler-frontmatter.js";
import type { Finding } from "../../lint-marketplace-metadata.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.join(__dirname, "fixtures");
const passingDir = path.join(fixturesDir, "handlers", "passing");
const failingDir = path.join(fixturesDir, "handlers", "failing");

// Repo root for real plugin trees
// __dirname = scripts/lint/__tests__/ → 3 levels up → plugins repo root
const repoRoot = path.resolve(__dirname, "../../../");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lintHandler(fixturePath: string): Finding[] {
  const findings: Finding[] = [];
  validateHandlerFile(fixturePath, "test-plugin", "test-handler", fixturesDir, findings);
  return findings;
}

function errors(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severity === "error");
}

function warnings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severity === "warning");
}

function codes(findings: Finding[]): string[] {
  return findings.map((f) => f.code);
}

// ---------------------------------------------------------------------------
// extractFrontmatter unit tests
// ---------------------------------------------------------------------------

describe("extractFrontmatter", () => {
  it("returns null for a file with no frontmatter", () => {
    expect(extractFrontmatter("# No frontmatter")).toBeNull();
  });

  it("returns null for a file with only a body", () => {
    expect(extractFrontmatter("Hello world\n---\nstuff")).toBeNull();
  });

  it("parses a simple frontmatter block", () => {
    const content = "---\nname: test\n---\nbody";
    const fm = extractFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm?.["name"]).toBe("test");
  });

  it("parses nested operational block", () => {
    const content = [
      "---",
      "name: test",
      "operational:",
      "  view_tool: test_view",
      "---",
      "body",
    ].join("\n");
    const fm = extractFrontmatter(content);
    expect(fm?.["operational"]).toBeDefined();
    expect((fm?.["operational"] as Record<string, unknown>)["view_tool"]).toBe("test_view");
  });
});

// ---------------------------------------------------------------------------
// Passing fixture
// ---------------------------------------------------------------------------

describe("Pass 6 — passing fixture", () => {
  it("full valid handler produces zero errors", () => {
    const findings = lintHandler(path.join(passingDir, "full-handler.md"));
    expect(errors(findings)).toHaveLength(0);
  });

  it("full valid handler produces zero warnings", () => {
    const findings = lintHandler(path.join(passingDir, "full-handler.md"));
    expect(warnings(findings)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stub handler — W03 warning
// ---------------------------------------------------------------------------

describe("Pass 6 — stub handler (no operational block)", () => {
  it("stub handler emits W03 warning, not an error", () => {
    const findings = lintHandler(path.join(failingDir, "stub-no-operational.md"));
    expect(errors(findings)).toHaveLength(0);
    expect(warnings(findings).length).toBeGreaterThan(0);
    expect(codes(warnings(findings))).toContain("W03");
  });

  it("W03 message mentions stub handler", () => {
    const findings = lintHandler(path.join(failingDir, "stub-no-operational.md"));
    const w03 = warnings(findings).filter((f) => f.code === "W03");
    expect(w03[0].message).toMatch(/stub handler/i);
  });
});

// ---------------------------------------------------------------------------
// E12 — missing required fields
// ---------------------------------------------------------------------------

describe("Pass 6 — E12-verb-phrases-missing", () => {
  it("emits E12-verb-phrases-missing when verb_phrases absent", () => {
    const findings = lintHandler(path.join(failingDir, "missing-verb-phrases.md"));
    expect(codes(errors(findings))).toContain("E12-verb-phrases-missing");
  });
});

describe("Pass 6 — E12-view-tool-missing", () => {
  it("emits E12-view-tool-missing when view_tool absent", () => {
    const findings = lintHandler(path.join(failingDir, "missing-view-tool.md"));
    const errs = errors(findings);
    expect(codes(errs)).toContain("E12-view-tool-missing");
  });
});

describe("Pass 6 — E12-view-tool-malformed (bad regex)", () => {
  it("emits E12-view-tool-malformed when view_tool fails ^[a-z][a-z0-9_]*_view$", () => {
    const findings = lintHandler(path.join(failingDir, "bad-view-tool-regex.md"));
    const errs = errors(findings);
    expect(codes(errs)).toContain("E12-view-tool-malformed");
  });

  it("E12-view-tool-malformed message references the offending field path", () => {
    const findings = lintHandler(path.join(failingDir, "bad-view-tool-regex.md"));
    const e12 = errors(findings).filter((f) => f.code === "E12-view-tool-malformed");
    expect(e12[0].message).toMatch(/view_tool/);
  });
});

describe("Pass 6 — E12-resource-uri-malformed (bad prefix)", () => {
  it("emits E12-resource-uri-malformed when resource_uri doesn't start with ui://", () => {
    const findings = lintHandler(path.join(failingDir, "bad-resource-uri.md"));
    const errs = errors(findings);
    expect(codes(errs)).toContain("E12-resource-uri-malformed");
  });

  it("E12-resource-uri-malformed message references resource_uri", () => {
    const findings = lintHandler(path.join(failingDir, "bad-resource-uri.md"));
    const e12 = errors(findings).filter((f) => f.code === "E12-resource-uri-malformed");
    expect(e12[0].message).toMatch(/resource_uri/);
  });
});

// ---------------------------------------------------------------------------
// finding structure
// ---------------------------------------------------------------------------

describe("Pass 6 — finding structure", () => {
  it("every finding has required fields: code, severity, plugin, file, message", () => {
    const allFindings = [
      ...lintHandler(path.join(failingDir, "missing-verb-phrases.md")),
      ...lintHandler(path.join(failingDir, "bad-view-tool-regex.md")),
      ...lintHandler(path.join(failingDir, "stub-no-operational.md")),
    ];
    for (const f of allFindings) {
      expect(f.code).toBeTruthy();
      expect(f.severity).toMatch(/^(error|warning)$/);
      expect(f.plugin).toBeTruthy();
      expect(f.file).toBeTruthy();
      expect(f.message).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Real plugin trees
// ---------------------------------------------------------------------------

describe("Pass 6 — real plugin trees", () => {
  it("canonical/ui-handlers/slack-thread passes with zero errors", () => {
    const findings: Finding[] = [];
    const handlerPath = path.join(
      repoRoot,
      "canonical",
      "ui-handlers",
      "slack-thread",
      "handler",
      "slack-thread.md",
    );
    validateHandlerFile(handlerPath, "canonical/slack-thread", "slack-thread", repoRoot, findings);
    expect(errors(findings)).toHaveLength(0);
  });

  it("notes-ingest has no ui-handlers dir — pass6 is a no-op (zero findings)", () => {
    const findings: Finding[] = [];
    const pluginDir = path.join(repoRoot, "plugins", "notes-ingest");
    pass6HandlerFrontmatter("notes-ingest", pluginDir, repoRoot, findings);
    expect(findings).toHaveLength(0);
  });

  it("agntux-core stub handlers emit W03 warnings only (no errors)", () => {
    const findings: Finding[] = [];
    const pluginDir = path.join(repoRoot, "plugins", "agntux-core");
    pass6HandlerFrontmatter("agntux-core", pluginDir, repoRoot, findings);
    expect(errors(findings)).toHaveLength(0);
    // Both triage.md and entity-browser.md are stubs — expect W03 warnings
    expect(warnings(findings).length).toBeGreaterThan(0);
    expect(codes(warnings(findings)).every((c) => c === "W03")).toBe(true);
  });
});

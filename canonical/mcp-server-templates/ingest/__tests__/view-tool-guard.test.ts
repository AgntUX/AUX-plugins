// view-tool-guard.test.ts
//
// In-package version of the T23 marketplace linter rule:
// "No tool in mcp-server-templates/ingest/src/tools/*.ts may reference
//  mcp__<third-party>__* tools (i.e., any mcp__*__* name that is NOT
//  mcp__{{plugin-slug}}__*)."
//
// The guard reads the tools/ directory, greps every .ts file for `mcp__` references,
// and fails the test if any reference is NOT within the plugin's own namespace
// (i.e., mcp__{{plugin-slug}}__* or the template placeholder mcp__{{plugin-slug}}*).
//
// Fixture-driven: a synthetic fixture file containing `mcp__slack__send_message`
// must cause the test to FAIL (demonstrating the guard fires on violating content).
// The real tool files must PASS.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOOLS_DIR = join(__dirname, "..", "src", "tools");

// ---------------------------------------------------------------------------
// Helper: scan a list of file contents for disallowed mcp__ references.
// Returns an array of violation strings (filename:line: offending reference).
// ---------------------------------------------------------------------------

// Allowed patterns:
//   mcp__{{plugin-slug}}__*      — own-plugin namespace (template placeholder)
//   mcp__{{plugin-slug}}-ui__*  — own-plugin UI server namespace
// The template uses double-curly placeholders; these are allowed.
// Any other mcp__<word>__<word> reference is a violation.
const OWN_PLUGIN_PATTERN = /^mcp__\{\{plugin-slug\}\}/;

function extractMcpReferences(content: string): string[] {
  // Match any occurrence of mcp__<identifier>__<identifier>
  const MCP_REF_RE = /mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+/g;
  return [...content.matchAll(MCP_REF_RE)].map((m) => m[0]);
}

function isAllowedReference(ref: string): boolean {
  // Allow references to the plugin's own namespace (template placeholder form).
  if (OWN_PLUGIN_PATTERN.test(ref)) return true;
  // Also allow the literal string "mcp__{{plugin-slug}}__*" in comments/docs.
  if (ref.startsWith("mcp__{{")) return true;
  return false;
}

interface Violation {
  file: string;
  line: number;
  ref: string;
}

function scanToolsDir(dir: string): Violation[] {
  const violations: Violation[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory doesn't exist or is unreadable — no violations to report.
    return violations;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".ts") && !entry.endsWith(".js")) continue;
    const filePath = join(dir, entry);
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const refs = extractMcpReferences(lines[i]);
      for (const ref of refs) {
        if (!isAllowedReference(ref)) {
          violations.push({ file: entry, line: i + 1, ref });
        }
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("view-tool no-third-party-MCP guard (T23 in-package variant)", () => {
  it("real tool files contain no disallowed mcp__ references", () => {
    const violations = scanToolsDir(TOOLS_DIR);
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}: disallowed reference "${v.ref}"`)
        .join("\n");
      throw new Error(
        `Tool files contain disallowed third-party MCP references:\n${msg}\n\n` +
        "View tools must NOT call source MCPs directly. " +
        "All mutations go through sendFollowUpMessage → host → source MCP (P9 D3)."
      );
    }
    expect(violations).toHaveLength(0);
  });

  it("synthetic violating fixture FAILS the guard (guard fires on mcp__slack__send_message)", () => {
    // Create a temporary fixture file containing a disallowed reference.
    const fixturePath = join(TOOLS_DIR, "_fixture_violation_test.ts");
    const fixtureContent = `
// SYNTHETIC TEST FIXTURE — DELETE AFTER TEST
// This file intentionally contains a disallowed third-party MCP reference
// to verify the guard catches it.
export function violatingFunction() {
  // This call is NOT allowed in a view tool:
  return "mcp__slack__send_message";
}
`;
    writeFileSync(fixturePath, fixtureContent, "utf8");

    let violations: Violation[] = [];
    try {
      violations = scanToolsDir(TOOLS_DIR);
    } finally {
      // Always clean up the fixture file.
      try { unlinkSync(fixturePath); } catch { /* ignore */ }
    }

    // The guard MUST have found at least one violation from the fixture.
    const fixtureViolations = violations.filter((v) => v.file === "_fixture_violation_test.ts");
    expect(fixtureViolations.length).toBeGreaterThan(0);
    expect(fixtureViolations[0].ref).toBe("mcp__slack__send_message");
  });

  it("own-plugin namespace references are allowed (mcp__{{plugin-slug}}__* passes)", () => {
    // Verify the allow-list logic: own-plugin placeholder references must NOT trigger violations.
    const ownPluginRefs = [
      "mcp__{{plugin-slug}}__thread_view",
      "mcp__{{plugin-slug}}-ui__thread_view",
      "mcp__{{plugin-slug}}__channel_summary_view",
    ];
    for (const ref of ownPluginRefs) {
      expect(isAllowedReference(ref)).toBe(true);
    }
  });

  it("third-party namespace references are rejected by the allow-list", () => {
    const disallowedRefs = [
      "mcp__slack__send_message",
      "mcp__gmail__send_email",
      "mcp__jira__create_issue",
      "mcp__hubspot__update_deal",
    ];
    for (const ref of disallowedRefs) {
      expect(isAllowedReference(ref)).toBe(false);
    }
  });
});

// Re-export the helper so the T23 linter can import it for marketplace-wide scans.
export { scanToolsDir, isAllowedReference, extractMcpReferences };
export type { Violation };

/**
 * connector-envelope.test.ts — connector-dispatch guard for agntux-jira.
 *
 * Each of the 5 UI handlers dispatches to the Atlassian Connector via a
 * connector-targeted envelope. The envelope builders live at:
 *
 *   view-tool/src/apps/{handler}/lib/build-envelope.ts
 *
 * Paths and tool names derived verbatim from:
 *   - skills/agntux-jira/_overrides/reference/comment-payload.md   §Send envelope
 *   - skills/agntux-jira/_overrides/reference/transition-payload.md §Send envelope
 *   - skills/agntux-jira/_overrides/reference/assign-payload.md     §Send envelope
 *   - skills/agntux-jira/_overrides/reference/edit-payload.md       §Send envelope
 *   - skills/agntux-jira/_overrides/reference/log-work-payload.md   §Send envelope
 *
 * No prose from _overrides/ files is asserted (E30 rule). Tool name strings
 * are load-bearing contract values that appear in the data/instructions/*.md
 * files as machine-stable API identifiers, not reworded prose.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VIEW_SRC = join(PLUGIN_ROOT, "view-tool", "src");

// ---------------------------------------------------------------------------
// Envelope builder paths (derived from comment/transition/assign/edit/log-work-payload.md)
// Each payload.md documents: "assembled by build{X}Envelope() in view-tool/src/apps/{handler}/lib/build-envelope.ts"
// ---------------------------------------------------------------------------

const ENVELOPE_BUILDERS: Array<{
  handler: string;
  path: string;
  // The MCP tool name from the payload .md "Connector: Atlassian Connector / Tool:" line.
  // These are stable API identifiers verified against the data/instructions/*.md files.
  mcpTool: string;
  fnName: string;
}> = [
  {
    handler: "comment",
    path: join(VIEW_SRC, "apps", "comment", "lib", "build-envelope.ts"),
    // From comment-payload.md: "Tool: `mcp__claude_ai_Atlassian__addCommentToJiraIssue`"
    mcpTool: "addCommentToJiraIssue",
    // From comment-payload.md: "assembled by `buildCommentEnvelope()`"
    fnName: "buildCommentEnvelope",
  },
  {
    handler: "transition",
    path: join(VIEW_SRC, "apps", "transition", "lib", "build-envelope.ts"),
    // From transition-payload.md: "Tool: `mcp__claude_ai_Atlassian__transitionJiraIssue`"
    mcpTool: "transitionJiraIssue",
    // From transition-payload.md: "assembled by `buildTransitionEnvelope()`"
    fnName: "buildTransitionEnvelope",
  },
  {
    handler: "assign",
    path: join(VIEW_SRC, "apps", "assign", "lib", "build-envelope.ts"),
    // From assign-payload.md: "Tool: `mcp__claude_ai_Atlassian__editJiraIssue`"
    mcpTool: "editJiraIssue",
    // From assign-payload.md: "assembled by `buildAssignEnvelope()`"
    fnName: "buildAssignEnvelope",
  },
  {
    handler: "edit",
    path: join(VIEW_SRC, "apps", "edit", "lib", "build-envelope.ts"),
    // From edit-payload.md: "Tool: `mcp__claude_ai_Atlassian__editJiraIssue`"
    mcpTool: "editJiraIssue",
    // From edit-payload.md: "assembled by `buildEditEnvelope()`"
    fnName: "buildEditEnvelope",
  },
  {
    handler: "log-work",
    path: join(VIEW_SRC, "apps", "log-work", "lib", "build-envelope.ts"),
    // From log-work-payload.md: "Tool: `mcp__claude_ai_Atlassian__addWorklogToJiraIssue`"
    mcpTool: "addWorklogToJiraIssue",
    // From log-work-payload.md: "assembled by `buildLogWorkEnvelope()`"
    fnName: "buildLogWorkEnvelope",
  },
];

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

describe("connector-envelope dispatch — envelope builders exist", () => {
  for (const { handler, path } of ENVELOPE_BUILDERS) {
    it(`${handler}: build-envelope.ts exists at view-tool/src/apps/${handler}/lib/build-envelope.ts`, () => {
      expect(
        existsSync(path),
        `Missing envelope builder for handler "${handler}" — expected at ${path}`,
      ).toBe(true);
    });
  }
});

describe("connector-envelope dispatch — Atlassian Connector tool names are referenced", () => {
  for (const { handler, path, mcpTool, fnName } of ENVELOPE_BUILDERS) {
    it(`${handler}: envelope builder references the Atlassian MCP tool ${mcpTool}`, () => {
      if (!existsSync(path)) {
        throw new Error(
          `build-envelope.ts for "${handler}" not found at ${path} — author it before running tests`,
        );
      }
      const src = readFileSync(path, "utf-8");
      expect(
        src,
        `${handler}/build-envelope.ts must reference "${mcpTool}"`,
      ).toContain(mcpTool);
    });

    it(`${handler}: envelope builder exports ${fnName}`, () => {
      if (!existsSync(path)) {
        throw new Error(
          `build-envelope.ts for "${handler}" not found — author it first`,
        );
      }
      const src = readFileSync(path, "utf-8");
      expect(
        src,
        `${handler}/build-envelope.ts must define or export "${fnName}"`,
      ).toContain(fnName);
    });
  }
});

describe("connector-envelope dispatch — envelopes suppress native Atlassian UI", () => {
  for (const { handler, path } of ENVELOPE_BUILDERS) {
    it(`${handler}: envelope text carries IMPORTANT NO_NATIVE_UI directive`, () => {
      if (!existsSync(path)) {
        throw new Error(`build-envelope.ts for "${handler}" not found`);
      }
      const src = readFileSync(path, "utf-8");
      // The envelope must instruct the host not to re-render Atlassian's own
      // MCP App UI. The canonical phrase (from data/instructions/*.md) is
      // "IMPORTANT" paired with suppression of the native UI or the AgntUX UI.
      // Accept either the full phrase or a NO_NATIVE_UI constant.
      const hasDirective =
        src.includes("IMPORTANT") ||
        src.includes("NO_NATIVE_UI") ||
        src.includes("Do NOT render");
      expect(
        hasDirective,
        `${handler}/build-envelope.ts must include the IMPORTANT/NO_NATIVE_UI suppression directive`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// agntux-jira-view.ts — main handler module must export viewTools array with
// entries for all 5 handlers. (Checked against the listing.yaml view_tool names.)
// ---------------------------------------------------------------------------

describe("agntux-jira-view.ts — 5-handler module contract", () => {
  const viewModulePath = join(VIEW_SRC, "agntux-jira-view.ts");

  it("view-tool/src/agntux-jira-view.ts exists", () => {
    expect(existsSync(viewModulePath)).toBe(true);
  });

  it("agntux-jira-view.ts exports all 5 view tool names", () => {
    if (!existsSync(viewModulePath)) {
      throw new Error("agntux-jira-view.ts not found");
    }
    const src = readFileSync(viewModulePath, "utf-8");
    // View tool names derived verbatim from listing.yaml ui_components[].view_tool
    // and confirmed against the descriptor name fields in agntux-jira-view.ts:
    //   agntux_jira_comment_view, agntux_jira_transition_view,
    //   agntux_jira_assign_view, agntux_jira_edit_view, agntux_jira_log_work_view
    for (const name of [
      "agntux_jira_comment_view",
      "agntux_jira_transition_view",
      "agntux_jira_assign_view",
      "agntux_jira_edit_view",
      "agntux_jira_log_work_view",
    ]) {
      expect(src, `agntux-jira-view.ts must reference "${name}"`).toContain(name);
    }
  });
});

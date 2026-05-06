/**
 * ui-routing.test.ts
 *
 * Static shape assertions for the compose and canvas UI handler manifests,
 * their backing MCP server tools and ui-resource files, and the surface
 * alignment between the ingest skill's suggested_actions host_prompts and
 * the view tools those prompts route into.
 *
 * LIMITATION (per T18 pattern): this test does NOT render the iframe or
 * invoke the view tools at runtime. It asserts that the operational
 * manifests, file existence, and prompt templates that wire the routing
 * chain together are all structurally correct.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readFile(p: string): string {
  return readFileSync(p, "utf-8");
}

/**
 * Parse the YAML frontmatter block (between the first two --- lines).
 * Returns the raw frontmatter string — callers can grep it directly.
 */
function extractFrontmatter(content: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// Compose UI routing
// ---------------------------------------------------------------------------

describe("compose UI routing", () => {
  const composeMdPath = join(PLUGIN_ROOT, "agents", "ui-handlers", "compose.md");

  it("agents/ui-handlers/compose.md exists", () => {
    expect(existsSync(composeMdPath)).toBe(true);
  });

  it("frontmatter has view_tool: agntux_slack_compose_view (v4.0.0+ prefixed name)", () => {
    const fm = extractFrontmatter(readFile(composeMdPath));
    expect(fm).toContain("view_tool: agntux_slack_compose_view");
  });

  it('frontmatter has resource_uri: "ui://slack-compose"', () => {
    const fm = extractFrontmatter(readFile(composeMdPath));
    expect(fm).toContain('resource_uri: "ui://slack-compose"');
  });

  it("verb_phrases contains the new 1.1.0+ direct-route phrases (action_id-only invocation)", () => {
    const src = readFile(composeMdPath);
    expect(src).toContain("open the reply composer for action");
    expect(src).toContain("open the reply composer in schedule mode for action");
  });

  it("verb_phrases retains the legacy 2.x.x phrases for backward compat with already-emitted action files", () => {
    const src = readFile(composeMdPath);
    expect(src).toContain("draft a reply for action");
    expect(src).toContain("draft a reply and schedule it for action");
  });

  it("verb_phrases does NOT contain user-direct trigger phrases (compose_view is suggested-action-driven, not chat-driven)", () => {
    // The view tool needs `action_id` to resolve the action file's
    // ## Compose payload. A user typing "compose slack reply" can't supply
    // it, and the harness LLM can't hallucinate it. Removing the
    // user-direct phrases avoids misleading the host into a dead-end
    // routing path. See compose.md frontmatter comment.
    const src = readFile(composeMdPath);
    expect(src).not.toContain('"compose slack reply"');
    expect(src).not.toContain('"slack draft view"');
  });

  it("follow_up_intents lists the 3.0.0 Slack-Connector-targeted commit keys plus local discard", () => {
    const src = readFile(composeMdPath);
    expect(src).toContain("slack-connector-send");
    expect(src).toContain("slack-connector-schedule");
    expect(src).toContain("slack-connector-save-draft");
    expect(src).toContain("compose-discard-local");
  });

  it("degraded_states block has the canonical source_not_found key (lint rule E12)", () => {
    const src = readFile(composeMdPath);
    expect(src).toContain("source_not_found");
  });

  it("mcp-server/src/tools/compose-view.ts exists", () => {
    expect(existsSync(join(PLUGIN_ROOT, "mcp-server", "src", "tools", "compose-view.ts"))).toBe(true);
  });

  it("mcp-server/src/ui-resources/compose.ts exists and contains an __EMBED__*__INDEX_HTML__ placeholder", () => {
    const uiResourcePath = join(PLUGIN_ROOT, "mcp-server", "src", "ui-resources", "compose.ts");
    expect(existsSync(uiResourcePath)).toBe(true);
    const src = readFile(uiResourcePath);
    // The placeholder token shape is __EMBED__<name>__INDEX_HTML__
    expect(src).toMatch(/__EMBED__\w+__INDEX_HTML__/);
    // Specifically the compose placeholder
    expect(src).toContain("__EMBED__compose__INDEX_HTML__");
  });

  it("ui-handlers/compose/component/package.json exists", () => {
    expect(
      existsSync(join(PLUGIN_ROOT, "ui-handlers", "compose", "component", "package.json"))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Canvas UI routing
// ---------------------------------------------------------------------------

describe("canvas UI routing", () => {
  const canvasMdPath = join(PLUGIN_ROOT, "agents", "ui-handlers", "canvas.md");

  it("agents/ui-handlers/canvas.md exists", () => {
    expect(existsSync(canvasMdPath)).toBe(true);
  });

  it("frontmatter has view_tool: agntux_slack_canvas_view (v4.0.0+ prefixed name)", () => {
    const fm = extractFrontmatter(readFile(canvasMdPath));
    expect(fm).toContain("view_tool: agntux_slack_canvas_view");
  });

  it('frontmatter has resource_uri: "ui://slack-canvas"', () => {
    const fm = extractFrontmatter(readFile(canvasMdPath));
    expect(fm).toContain('resource_uri: "ui://slack-canvas"');
  });

  it("verb_phrases contains the new 1.1.0+ direct-route phrase (action_id-only invocation)", () => {
    const src = readFile(canvasMdPath);
    expect(src).toContain("open the canvas summariser for action");
  });

  it("verb_phrases retains the legacy 2.x.x 'summarise the thread for action' phrase", () => {
    const src = readFile(canvasMdPath);
    expect(src).toContain("summarise the thread for action");
  });

  it("verb_phrases does NOT contain user-direct trigger phrases (canvas_view is suggested-action-driven, not chat-driven)", () => {
    // The view tool needs `action_id` to resolve the action file's
    // ## Canvas payload. A user typing "summarise to canvas" can't supply
    // it, and the harness LLM can't hallucinate it. Removing the
    // user-direct phrases avoids misleading the host into a dead-end
    // routing path. See canvas.md frontmatter comment.
    const src = readFile(canvasMdPath);
    expect(src).not.toContain('"summarise to canvas"');
    expect(src).not.toContain('"slack canvas view"');
  });

  it("follow_up_intents lists the 3.0.0 Slack-Connector-targeted canvas key plus local discard", () => {
    const src = readFile(canvasMdPath);
    expect(src).toContain("slack-connector-create-canvas-and-post");
    expect(src).toContain("canvas-discard-local");
  });

  it("degraded_states block has the canonical source_not_found key (lint rule E12)", () => {
    const src = readFile(canvasMdPath);
    expect(src).toContain("source_not_found");
  });

  it("mcp-server/src/tools/canvas-view.ts exists", () => {
    expect(existsSync(join(PLUGIN_ROOT, "mcp-server", "src", "tools", "canvas-view.ts"))).toBe(true);
  });

  it("mcp-server/src/ui-resources/canvas.ts exists and contains an __EMBED__*__INDEX_HTML__ placeholder", () => {
    const uiResourcePath = join(PLUGIN_ROOT, "mcp-server", "src", "ui-resources", "canvas.ts");
    expect(existsSync(uiResourcePath)).toBe(true);
    const src = readFile(uiResourcePath);
    expect(src).toMatch(/__EMBED__\w+__INDEX_HTML__/);
    expect(src).toContain("__EMBED__canvas__INDEX_HTML__");
  });

  it("ui-handlers/canvas/component/package.json exists", () => {
    expect(
      existsSync(join(PLUGIN_ROOT, "ui-handlers", "canvas", "component", "package.json"))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// suggested_actions surface alignment
// ---------------------------------------------------------------------------

describe("suggested_actions surface alignment (1.1.0+)", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", "sync", "SKILL.md");

  it("sync SKILL.md contains the Draft host_prompt that routes directly into compose_view", () => {
    const src = readFile(syncSkill);
    // 1.1.0+ shape — prompt matches compose_view's tool description directly
    // (no draft-skill round-trip). The view tool lifts drafted_body and
    // thread_context from the action file's `## Compose payload` body
    // section.
    expect(src).toContain(
      "ux: Use the agntux-slack plugin to open the reply composer for action {id}."
    );
  });

  it("sync SKILL.md contains the Schedule host_prompt that routes directly into compose_view (schedule mode)", () => {
    const src = readFile(syncSkill);
    expect(src).toContain(
      "ux: Use the agntux-slack plugin to open the reply composer in schedule mode for action {id}."
    );
  });

  it("sync SKILL.md contains the Summarise host_prompt that routes directly into canvas_view", () => {
    const src = readFile(syncSkill);
    expect(src).toContain(
      "ux: Use the agntux-slack plugin to open the canvas summariser for action {id}."
    );
  });
});

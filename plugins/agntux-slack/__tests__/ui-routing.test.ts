/**
 * ui-routing.test.ts
 *
 * Static shape assertions for the compose and canvas UI routing chain
 * after the de-fork sweep:
 *   - The deleted `agents/ui-handlers/{compose,canvas}.md` metadata
 *     files are gone — every field they carried (verb_phrases,
 *     view_tool, resource_uri, structured_content_schema,
 *     follow_up_intents, degraded_states) now lives in either the
 *     view tool's `description` / `inputSchema` / `outputSchema`
 *     blocks (`mcp-server/src/tools/{compose,canvas}-view.ts`), the
 *     iframe component's commit-envelope code, or the action item's
 *     `suggested_actions[]` rows.
 *   - The sync skill emits `host_prompt` strings against the view
 *     tools' descriptions; the host's tool selector matches them
 *     against the description and invokes the tool with `action_id`
 *     only.
 *
 * LIMITATION: this test does NOT render the iframe or invoke the view
 * tools at runtime. It asserts that the tool descriptors, file
 * existence, and prompt templates that wire the routing chain are
 * structurally correct.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const PLUGIN_SLUG = (
  JSON.parse(
    readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
  ) as { name: string }
).name;

// When reading the slug-named SKILL.md, fold in sibling reference/*.md files
// (sorted) with `<!-- {filename} -->` boundary markers so grep-style
// assertions on procedural body content keep working post-router-split.
// Pass-through for all other paths.
function readFile(p: string): string {
  const content = readFileSync(p, "utf-8");
  if (basename(p) === "SKILL.md" && basename(dirname(p)) === PLUGIN_SLUG) {
    const referenceDir = join(dirname(p), "reference");
    if (existsSync(referenceDir)) {
      const parts = [content];
      for (const name of readdirSync(referenceDir).filter((f) => f.endsWith(".md")).sort()) {
        parts.push(`\n<!-- ${name} -->\n`);
        parts.push(readFileSync(join(referenceDir, name), "utf-8"));
      }
      return parts.join("");
    }
  }
  return content;
}

// Read a TypeScript view-tool source file and collapse string-concatenation
// continuations (`" +\n  "`) so substring assertions can match prose that
// the formatter wrapped across multiple lines. Mirrors what TypeScript would
// emit at runtime — the description string the host actually sees.
function readToolSource(p: string): string {
  const raw = readFileSync(p, "utf-8");
  // Match `"...end-of-string" + \n  "...start-of-next-string"` and collapse
  // to a single contiguous string. The lookahead form keeps the surrounding
  // quotes intact so non-concatenated strings stay untouched.
  return raw.replace(/"\s*\+\s*\n\s*"/g, "");
}

// ---------------------------------------------------------------------------
// agents/ui-handlers/ metadata files have been retired
// ---------------------------------------------------------------------------

describe("ui-handler metadata files are retired", () => {
  it("agents/ui-handlers/compose.md is gone (description+inputSchema own the routing surface)", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents", "ui-handlers", "compose.md"))).toBe(false);
  });

  it("agents/ui-handlers/canvas.md is gone", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents", "ui-handlers", "canvas.md"))).toBe(false);
  });

  it("the entire agents/ directory is gone (no other agents survive in agntux-slack)", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Compose view tool — description carries the trigger phrases inline
// ---------------------------------------------------------------------------

describe("compose-view tool descriptor", () => {
  const composeViewPath = join(PLUGIN_ROOT, "mcp-server", "src", "tools", "compose-view.ts");

  it("mcp-server/src/tools/compose-view.ts exists", () => {
    expect(existsSync(composeViewPath)).toBe(true);
  });

  it("tool name is the v4.0.0+ namespaced agntux_slack_compose_view", () => {
    const src = readFile(composeViewPath);
    expect(src).toContain('name: "agntux_slack_compose_view"');
  });

  it("description carries the suggested-action-driven trigger phrases inline (the host's tool selector matches against this)", () => {
    const src = readToolSource(composeViewPath);
    expect(src).toContain("open the reply composer for action {id}");
    expect(src).toContain("draft a reply for action {id}");
  });

  it("description names host_prompt as the routing channel from triage's Draft/Schedule buttons", () => {
    const src = readToolSource(composeViewPath);
    expect(src).toMatch(/triage's Draft\/Schedule buttons fire this tool[\s\S]*via host_prompt/);
  });

  it("description tells the host to pass ONLY action_id (no inline payload override)", () => {
    const src = readToolSource(composeViewPath);
    expect(src).toContain("Pass ONLY action_id");
  });

  it("inputSchema requires action_id and only action_id (legacy back-compat fields removed)", () => {
    const src = readFile(composeViewPath);
    // Match the inputSchema block. The only `properties:` field must be `action_id`.
    const inputSchemaMatch = src.match(/inputSchema:\s*\{[\s\S]*?required:\s*\[[^\]]*\],?\s*\}/);
    expect(inputSchemaMatch).toBeTruthy();
    const block = inputSchemaMatch![0];
    expect(block).toContain("action_id");
    expect(block).toContain('required: ["action_id"]');
    // Legacy back-compat fields must NOT live on the input surface
    expect(block).not.toContain("initial_verb");
    expect(block).not.toContain("drafted_body");
    expect(block).not.toContain("personalization_signals");
    expect(block).not.toContain("thread_context");
    expect(block).not.toContain("channel:");
    expect(block).not.toContain("proposed_send_time");
    expect(block).not.toContain("slack_permalink");
  });

  it("declares ui://slack-compose as the resource URI in both _meta.ui and _meta['ui/resourceUri']", () => {
    const src = readFile(composeViewPath);
    expect(src).toContain('COMPOSE_RESOURCE_URI = "ui://slack-compose"');
    expect(src).toMatch(/ui:\s*\{\s*resourceUri:\s*COMPOSE_RESOURCE_URI/);
    expect(src).toMatch(/"ui\/resourceUri":\s*COMPOSE_RESOURCE_URI/);
  });

  it("structuredContent declares the canonical compose-iframe payload fields (replacing structured_content_schema metadata)", () => {
    const src = readFile(composeViewPath);
    expect(src).toContain("ComposeStructuredContent");
    for (const field of [
      "action_id",
      "initial_verb",
      "channel",
      "thread",
      "drafted_body",
      "personalization_signals",
    ]) {
      expect(src).toContain(field);
    }
  });

  it("structured-error envelope declares the canonical degraded-state codes (replacing degraded_states metadata)", () => {
    const src = readFile(composeViewPath);
    // The canonical degraded-state union — these are surfaced as
    // structuredContent.error envelopes the iframe renders.
    for (const code of [
      "action_not_found",
      "action_already_handled",
      "compose_payload_missing",
    ]) {
      expect(src).toContain(`"${code}"`);
    }
  });

  it("ui-handlers/compose/component/package.json exists", () => {
    expect(
      existsSync(join(PLUGIN_ROOT, "ui-handlers", "compose", "component", "package.json")),
    ).toBe(true);
  });

  it("mcp-server/src/ui-resources/compose.ts exists and contains an __EMBED__*__INDEX_HTML__ placeholder", () => {
    const uiResourcePath = join(PLUGIN_ROOT, "mcp-server", "src", "ui-resources", "compose.ts");
    expect(existsSync(uiResourcePath)).toBe(true);
    const src = readFile(uiResourcePath);
    expect(src).toMatch(/__EMBED__\w+__INDEX_HTML__/);
    expect(src).toContain("__EMBED__compose__INDEX_HTML__");
  });
});

// ---------------------------------------------------------------------------
// Canvas view tool — description carries the trigger phrases inline
// ---------------------------------------------------------------------------

describe("canvas-view tool descriptor", () => {
  const canvasViewPath = join(PLUGIN_ROOT, "mcp-server", "src", "tools", "canvas-view.ts");

  it("mcp-server/src/tools/canvas-view.ts exists", () => {
    expect(existsSync(canvasViewPath)).toBe(true);
  });

  it("tool name is the v4.0.0+ namespaced agntux_slack_canvas_view", () => {
    const src = readFile(canvasViewPath);
    expect(src).toContain('name: "agntux_slack_canvas_view"');
  });

  it("description carries the suggested-action-driven trigger phrases inline", () => {
    const src = readToolSource(canvasViewPath);
    expect(src).toContain("summarise the thread for action {id}");
    expect(src).toContain("open the canvas summariser for action {id}");
  });

  it("description names host_prompt as the routing channel from triage's Open canvas button", () => {
    const src = readToolSource(canvasViewPath);
    expect(src).toMatch(/triage's Open canvas[\s\S]*via host_prompt/);
  });

  it("inputSchema requires action_id and only action_id (legacy back-compat fields removed)", () => {
    const src = readFile(canvasViewPath);
    const inputSchemaMatch = src.match(/inputSchema:\s*\{[\s\S]*?required:\s*\[[^\]]*\],?\s*\}/);
    expect(inputSchemaMatch).toBeTruthy();
    const block = inputSchemaMatch![0];
    expect(block).toContain("action_id");
    expect(block).toContain('required: ["action_id"]');
    expect(block).not.toContain("drafted_canvas");
    expect(block).not.toContain("proposed_followup_message");
  });

  it("declares ui://slack-canvas as the resource URI in both _meta.ui and _meta['ui/resourceUri']", () => {
    const src = readFile(canvasViewPath);
    expect(src).toContain('CANVAS_RESOURCE_URI = "ui://slack-canvas"');
    expect(src).toMatch(/ui:\s*\{\s*resourceUri:\s*CANVAS_RESOURCE_URI/);
    expect(src).toMatch(/"ui\/resourceUri":\s*CANVAS_RESOURCE_URI/);
  });

  it("structuredContent declares the canonical canvas-iframe payload fields", () => {
    const src = readFile(canvasViewPath);
    expect(src).toContain("CanvasStructuredContent");
    for (const field of [
      "action_id",
      "channel",
      "thread",
      "drafted_canvas",
      "proposed_followup_message",
    ]) {
      expect(src).toContain(field);
    }
  });

  it("structured-error envelope declares the canonical degraded-state codes", () => {
    const src = readFile(canvasViewPath);
    for (const code of [
      "action_not_found",
      "action_already_handled",
      "canvas_payload_missing",
    ]) {
      expect(src).toContain(`"${code}"`);
    }
  });

  it("ui-handlers/canvas/component/package.json exists", () => {
    expect(
      existsSync(join(PLUGIN_ROOT, "ui-handlers", "canvas", "component", "package.json")),
    ).toBe(true);
  });

  it("mcp-server/src/ui-resources/canvas.ts exists and contains an __EMBED__*__INDEX_HTML__ placeholder", () => {
    const uiResourcePath = join(PLUGIN_ROOT, "mcp-server", "src", "ui-resources", "canvas.ts");
    expect(existsSync(uiResourcePath)).toBe(true);
    const src = readFile(uiResourcePath);
    expect(src).toMatch(/__EMBED__\w+__INDEX_HTML__/);
    expect(src).toContain("__EMBED__canvas__INDEX_HTML__");
  });
});

// ---------------------------------------------------------------------------
// suggested_actions surface alignment — sync skill host_prompts route
// directly into the view tools' descriptions
// ---------------------------------------------------------------------------

describe("suggested_actions host_prompt → view-tool description routing", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");

  it("sync SKILL emits the Draft host_prompt that compose-view's description matches", () => {
    const src = readFile(syncSkill);
    expect(src).toContain(
      "ux: Use the agntux-slack plugin to open the reply composer for action {id}.",
    );
  });

  it("sync SKILL emits the Schedule host_prompt that compose-view's description matches", () => {
    const src = readFile(syncSkill);
    expect(src).toContain(
      "ux: Use the agntux-slack plugin to open the reply composer in schedule mode for action {id}.",
    );
  });

  it("sync SKILL emits the Summarise host_prompt that canvas-view's description matches", () => {
    const src = readFile(syncSkill);
    expect(src).toContain(
      "ux: Use the agntux-slack plugin to open the canvas summariser for action {id}.",
    );
  });
});

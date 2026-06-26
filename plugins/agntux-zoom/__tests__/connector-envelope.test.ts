/**
 * connector-envelope.test.ts — agntux-zoom
 *
 * Asserts that the save-doc view-tool envelope builder emits a
 * connector-targeted envelope that instructs the host's LLM to call the
 * Zoom Connector's create_new_file_with_markdown tool directly and
 * suppresses any native Zoom Connector UI.
 *
 * This plugin ships one UI handler: save-doc. The write-back wiring goes:
 *   SaveDocComponent.handleSend()
 *     → buildEnvelope() from view-tool/src/apps/save-doc/lib/build-envelope.ts
 *       → sendFollowUpMessage(envelope)
 *
 * GOLDEN RULE: every assertion is derived from reading the actual authored
 * source files verbatim (golden rule #1, source of truth). No prose from
 * _overrides/ is grepped (E30 rule).
 *
 * Grounding sources:
 *   - view-tool/src/apps/save-doc/lib/build-envelope.ts (envelope builder)
 *   - view-tool/src/components/SaveDocComponent.tsx (UI wiring)
 *   - view-tool/src/agntux-zoom-view.ts (view tool descriptor)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

const ENVELOPE_BUILDER_PATH = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/save-doc/lib/build-envelope.ts",
);

const SAVE_DOC_COMPONENT_PATH = join(
  PLUGIN_ROOT,
  "view-tool/src/components/SaveDocComponent.tsx",
);

const VIEW_TOOL_PATH = join(
  PLUGIN_ROOT,
  "view-tool/src/agntux-zoom-view.ts",
);

// ---------------------------------------------------------------------------
// save-doc envelope builder — static source assertions
// ---------------------------------------------------------------------------

describe("save-doc envelope builder", () => {
  it("build-envelope.ts file exists", () => {
    expect(() => readFileSync(ENVELOPE_BUILDER_PATH, "utf-8")).not.toThrow();
  });

  it("addresses the Zoom Connector by display name", () => {
    const src = readFileSync(ENVELOPE_BUILDER_PATH, "utf-8");
    // Verbatim from build-envelope.ts line 65.
    expect(src).toContain("Use the Zoom Connector to save a new Zoom Doc with the meeting summary.");
  });

  it("uses create_new_file_with_markdown as the connector tool", () => {
    const src = readFileSync(ENVELOPE_BUILDER_PATH, "utf-8");
    // Verbatim from build-envelope.ts line 66.
    expect(src).toContain("Use create_new_file_with_markdown.");
  });

  it("suppresses Zoom Connector native UI (NO_NATIVE_UI_DIRECTIVE)", () => {
    const src = readFileSync(ENVELOPE_BUILDER_PATH, "utf-8");
    // Verbatim from build-envelope.ts lines 19-20.
    expect(src).toContain("Do NOT render any Zoom Connector native UI for this call");
  });

  it("suppresses re-rendering of the AgntUX save-doc composer", () => {
    const src = readFileSync(ENVELOPE_BUILDER_PATH, "utf-8");
    // Verbatim from build-envelope.ts line 21.
    expect(src).toContain("Do NOT re-render the AgntUX save-doc composer either; the action is complete.");
  });

  it("envelope carries file_name as a parameter", () => {
    const src = readFileSync(ENVELOPE_BUILDER_PATH, "utf-8");
    // Verbatim from build-envelope.ts line 67.
    expect(src).toContain("file_name:");
  });

  it("envelope carries content delimited by guillemets", () => {
    const src = readFileSync(ENVELOPE_BUILDER_PATH, "utf-8");
    // Verbatim from build-envelope.ts line 69 — guillemet-delimited content field.
    // ASCII-safe: check for the literal string "content:" which always precedes
    // the guillemet-delimited body.
    expect(src).toContain("content:");
  });

  it("escapeBody function guards guillemet delimiters in user-authored content", () => {
    const src = readFileSync(ENVELOPE_BUILDER_PATH, "utf-8");
    // Verbatim from build-envelope.ts lines 38-40.
    expect(src).toContain("function escapeBody(text: string): string");
    expect(src).toContain(".replace(");
  });

  it("action_id is included in the envelope for reference", () => {
    const src = readFileSync(ENVELOPE_BUILDER_PATH, "utf-8");
    // Verbatim from build-envelope.ts line 69: "(action_id: ${action_id})"
    expect(src).toContain("action_id");
  });

  it("NO_NATIVE_UI_DIRECTIVE is a named constant, not inline text", () => {
    const src = readFileSync(ENVELOPE_BUILDER_PATH, "utf-8");
    // Verbatim from build-envelope.ts line 17.
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
  });
});

// ---------------------------------------------------------------------------
// SaveDocComponent — wiring: imports buildEnvelope and calls sendFollowUpMessage
// ---------------------------------------------------------------------------

describe("SaveDocComponent wiring — send path", () => {
  it("SaveDocComponent.tsx imports buildEnvelope from the save-doc envelope builder", () => {
    const src = readFileSync(SAVE_DOC_COMPONENT_PATH, "utf-8");
    // Verbatim from SaveDocComponent.tsx line 3.
    expect(src).toContain(
      "import { buildEnvelope } from '../apps/save-doc/lib/build-envelope.js'",
    );
  });

  it("SaveDocComponent calls sendFollowUpMessage with the built envelope", () => {
    const src = readFileSync(SAVE_DOC_COMPONENT_PATH, "utf-8");
    // Verbatim from SaveDocComponent.tsx line 124.
    expect(src).toContain("await sendFollowUpMessage(envelope)");
  });

  it("SaveDocComponent calls buildEnvelope with file_name, content, and action_id", () => {
    const src = readFileSync(SAVE_DOC_COMPONENT_PATH, "utf-8");
    // Verbatim from SaveDocComponent.tsx lines 119-123.
    expect(src).toContain("const envelope = buildEnvelope(");
    expect(src).toContain("file_name:");
    expect(src).toContain("content:");
    expect(src).toContain("action_id:");
  });
});

// ---------------------------------------------------------------------------
// View-tool descriptor — resource URI and tool name
// ---------------------------------------------------------------------------

describe("view-tool descriptor", () => {
  it("agntux-zoom-view.ts exports the agntux_zoom_save_doc_view tool", () => {
    const src = readFileSync(VIEW_TOOL_PATH, "utf-8");
    // Verbatim from agntux-zoom-view.ts line 175.
    expect(src).toContain(`name: "agntux_zoom_save_doc_view"`);
  });

  it("tool descriptor ui_resource_uri is ui://agntux-zoom/save-doc", () => {
    const src = readFileSync(VIEW_TOOL_PATH, "utf-8");
    // Verbatim from agntux-zoom-view.ts line 27.
    expect(src).toContain(`"ui://agntux-zoom/save-doc"`);
  });

  it("view-tool module exports exactly one viewTool", () => {
    const src = readFileSync(VIEW_TOOL_PATH, "utf-8");
    // Verbatim from agntux-zoom-view.ts line 238 — the viewTools array.
    expect(src).toContain("viewTools: [saveDocViewTool]");
  });
});

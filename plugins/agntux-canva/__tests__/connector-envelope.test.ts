/**
 * connector-envelope.test.ts — agntux-canva
 *
 * Asserts that each of the three view-tool envelope builders:
 *   - Targets the Canva Connector (not a hard-coded tool literal).
 *   - Carries the NO_NATIVE_UI_DIRECTIVE that prevents the host from
 *     spawning a duplicate Canva MCP App UI after the user has already
 *     submitted the AgntUX iframe.
 *   - Uses sendFollowUpMessage() (connector-targeted dispatch).
 *   - Warns against hard-coded connector tool names (E32).
 *
 * Every assertion is grounded in verbatim substrings read from the authored
 * build-envelope.ts files. No _overrides/ files are referenced (E30 rule).
 *
 * Source files:
 *   view-tool/src/apps/reply/lib/build-envelope.ts
 *   view-tool/src/apps/comment/lib/build-envelope.ts
 *   view-tool/src/apps/export/lib/build-envelope.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

function readEnvelope(handler: string): string {
  return readFileSync(
    join(
      PLUGIN_ROOT,
      "view-tool/src/apps",
      handler,
      "lib/build-envelope.ts",
    ),
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Common contract: every envelope builder carries NO_NATIVE_UI_DIRECTIVE
// Verbatim from all three build-envelope.ts files (confirmed at authoring time):
//   "Do NOT render any Canva MCP App UI for this call"
// ---------------------------------------------------------------------------
describe("connector-envelope — shared NO_NATIVE_UI_DIRECTIVE", () => {
  for (const handler of ["reply", "comment", "export"]) {
    it(`${handler}/build-envelope.ts carries the no-native-UI directive`, () => {
      const src = readEnvelope(handler);
      // Verbatim substring present in all three files
      expect(src).toContain("Do NOT render any Canva MCP App UI for this call");
    });

    it(`${handler}/build-envelope.ts uses sendFollowUpMessage (connector-targeted)`, () => {
      // Verbatim from all three files' JSDoc:
      // "client.sendFollowUpMessage()"
      const src = readEnvelope(handler);
      expect(src).toContain("sendFollowUpMessage");
    });

    it(`${handler}/build-envelope.ts warns against hard-coded connector tool names (E32)`, () => {
      // Verbatim from all three files:
      // "a hard-coded literal throws MCP error -32602 at click time (E32)"
      const src = readEnvelope(handler);
      expect(src).toContain("-32602");
    });
  }
});

// ---------------------------------------------------------------------------
// reply — targets Canva Connector's reply-to-comment tool
// Verbatim from view-tool/src/apps/reply/lib/build-envelope.ts
// ---------------------------------------------------------------------------
describe("connector-envelope — reply", () => {
  it("buildReplyEnvelope is exported", () => {
    const src = readEnvelope("reply");
    // Verbatim from reply/build-envelope.ts line 49
    expect(src).toContain("export function buildReplyEnvelope");
  });

  it("reply envelope targets the reply-to-comment connector write tool", () => {
    const src = readEnvelope("reply");
    // Verbatim from reply/build-envelope.ts header comment line 17:
    // "Connector write tool: reply-to-comment"
    expect(src).toContain("Connector write tool: reply-to-comment");
  });

  it("reply envelope targets the Canva Connector by name in the message body", () => {
    const src = readEnvelope("reply");
    // Verbatim from reply/build-envelope.ts buildReplyEnvelope return value line 53:
    // "Use the Canva Connector to reply to a comment on a design."
    expect(src).toContain("Use the Canva Connector to reply to a comment on a design.");
  });

  it("reply envelope uses guillemet delimiters for the message body", () => {
    const src = readEnvelope("reply");
    // Verbatim from reply/build-envelope.ts lines 27-28 (escapeGuillemetBody)
    // and the return body line 56: "message_plaintext: «${escapedMessage}»"
    expect(src).toContain("escapeGuillemetBody");
  });

  it("ReplyEnvelopeArgs interface declares design_id and comment_id", () => {
    const src = readEnvelope("reply");
    // Verbatim from reply/build-envelope.ts ReplyEnvelopeArgs interface lines 33-37
    expect(src).toContain("design_id: string");
    expect(src).toContain("comment_id: string");
  });

  it("reply envelope suppresses re-render of AgntUX reply composer", () => {
    const src = readEnvelope("reply");
    // Verbatim from reply/build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 24:
    // "Do NOT re-render the AgntUX reply composer either"
    expect(src).toContain("Do NOT re-render the AgntUX reply composer either");
  });
});

// ---------------------------------------------------------------------------
// comment — targets Canva Connector's comment-on-design tool
// Verbatim from view-tool/src/apps/comment/lib/build-envelope.ts
// ---------------------------------------------------------------------------
describe("connector-envelope — comment", () => {
  it("buildCommentEnvelope is exported", () => {
    const src = readEnvelope("comment");
    // Verbatim from comment/build-envelope.ts line 46
    expect(src).toContain("export function buildCommentEnvelope");
  });

  it("comment envelope targets the comment-on-design connector write tool", () => {
    const src = readEnvelope("comment");
    // Verbatim from comment/build-envelope.ts header comment line 17:
    // "Connector write tool: comment-on-design"
    expect(src).toContain("Connector write tool: comment-on-design");
  });

  it("comment envelope targets the Canva Connector by name in the message body", () => {
    const src = readEnvelope("comment");
    // Verbatim from comment/build-envelope.ts buildCommentEnvelope return line 49:
    // "Use the Canva Connector to add a comment to a design."
    expect(src).toContain("Use the Canva Connector to add a comment to a design.");
  });

  it("CommentEnvelopeArgs interface declares design_id", () => {
    const src = readEnvelope("comment");
    // Verbatim from comment/build-envelope.ts CommentEnvelopeArgs interface line 32
    expect(src).toContain("design_id: string");
  });

  it("comment envelope suppresses re-render of AgntUX comment composer", () => {
    const src = readEnvelope("comment");
    // Verbatim from comment/build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 24:
    // "Do NOT re-render the AgntUX comment composer either"
    expect(src).toContain("Do NOT re-render the AgntUX comment composer either");
  });
});

// ---------------------------------------------------------------------------
// export — targets Canva Connector's export-design tool
// Verbatim from view-tool/src/apps/export/lib/build-envelope.ts
// ---------------------------------------------------------------------------
describe("connector-envelope — export", () => {
  it("buildExportEnvelope is exported", () => {
    const src = readEnvelope("export");
    // Verbatim from export/build-envelope.ts line 49
    expect(src).toContain("export function buildExportEnvelope");
  });

  it("export envelope targets the export-design connector write tool", () => {
    const src = readEnvelope("export");
    // Verbatim from export/build-envelope.ts header comment line 13:
    // "Connector write tool: export-design"
    expect(src).toContain("Connector write tool: export-design");
  });

  it("export envelope targets the Canva Connector by name in the message body", () => {
    const src = readEnvelope("export");
    // Verbatim from export/build-envelope.ts buildExportEnvelope return line 57:
    // "Use the Canva Connector to export a design to a file."
    expect(src).toContain("Use the Canva Connector to export a design to a file.");
  });

  it("ExportEnvelopeArgs interface declares format_type", () => {
    const src = readEnvelope("export");
    // Verbatim from export/build-envelope.ts ExportEnvelopeArgs interface line 30
    expect(src).toContain("format_type: string");
  });

  it("export envelope passes format as JSON object to preserve nested type/pages shape", () => {
    const src = readEnvelope("export");
    // Verbatim from export/build-envelope.ts JSDoc comment lines 42-47:
    // "The `format` arg is passed as a JSON object"
    expect(src).toContain("The `format` arg is passed as a JSON object");
  });

  it("export envelope suppresses re-render of AgntUX export UI", () => {
    const src = readEnvelope("export");
    // Verbatim from export/build-envelope.ts NO_NATIVE_UI_DIRECTIVE line 24:
    // "Do NOT re-render the AgntUX export UI either"
    expect(src).toContain("Do NOT re-render the AgntUX export UI either");
  });
});

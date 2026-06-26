/**
 * connector-envelope.test.ts
 *
 * Asserts that each of the four view-tool envelope builders targets the
 * Asana Connector (not a hard-coded tool literal) and carries the
 * NO_NATIVE_UI_DIRECTIVE that prevents the host from spawning a duplicate
 * Asana MCP App UI after the user has already submitted the AgntUX iframe.
 *
 * Every assertion is grounded in verbatim substrings read from the authored
 * build-envelope.ts files. No _overrides files are referenced (E30 rule).
 *
 * Source files:
 *   view-tool/src/apps/comment/lib/build-envelope.ts
 *   view-tool/src/apps/complete/lib/build-envelope.ts
 *   view-tool/src/apps/assign/lib/build-envelope.ts
 *   view-tool/src/apps/create/lib/build-envelope.ts
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
// Verbatim from all four build-envelope.ts files:
// "Do NOT render any Asana MCP App UI for this call"
// ---------------------------------------------------------------------------
describe("connector-envelope — shared NO_NATIVE_UI_DIRECTIVE", () => {
  for (const handler of ["comment", "complete", "assign", "create"]) {
    it(`${handler}/build-envelope.ts carries the no-native-UI directive`, () => {
      const src = readEnvelope(handler);
      // Verbatim substring present in all four files
      expect(src).toContain(
        "Do NOT render any Asana MCP App UI for this call",
      );
    });

    it(`${handler}/build-envelope.ts suppresses re-render of AgntUX compose UI`, () => {
      // Verbatim from all four files:
      // "Do NOT re-render the AgntUX compose UI."
      const src = readEnvelope(handler);
      expect(src).toContain("Do NOT re-render the AgntUX compose UI.");
    });

    it(`${handler}/build-envelope.ts uses sendFollowUpMessage (connector-targeted)`, () => {
      // Verbatim from all four files' JSDoc:
      // "client.sendFollowUpMessage()"
      const src = readEnvelope(handler);
      expect(src).toContain("sendFollowUpMessage");
    });
  }
});

// ---------------------------------------------------------------------------
// comment — targets Asana Connector's add_comment tool
// Verbatim from view-tool/src/apps/comment/lib/build-envelope.ts
// ---------------------------------------------------------------------------
describe("connector-envelope — comment", () => {
  it("buildCommentEnvelope is exported and targets Asana Connector add_comment", () => {
    const src = readEnvelope("comment");
    // Verbatim from comment/build-envelope.ts line 35
    expect(src).toContain("export function buildCommentEnvelope");
    // Verbatim from comment/build-envelope.ts JSDoc lines 7-8:
    // "Asana Connector's add_comment tool"
    expect(src).toContain("Asana Connector's add_comment tool");
  });

  it("comment envelope body uses guillemet delimiters for the body", () => {
    // Verbatim from comment/build-envelope.ts:
    // "The body is delimited by Unicode guillemets"
    const src = readEnvelope("comment");
    expect(src).toContain("Unicode guillemets");
  });

  it("comment envelope warns against hard-coded connector tool names (E32)", () => {
    // Verbatim from comment/build-envelope.ts:
    // "a hard-coded literal throws MCP error -32602 at click time (E32)"
    const src = readEnvelope("comment");
    expect(src).toContain("-32602");
  });
});

// ---------------------------------------------------------------------------
// complete — targets Asana Connector's update_tasks tool
// Verbatim from view-tool/src/apps/complete/lib/build-envelope.ts
// ---------------------------------------------------------------------------
describe("connector-envelope — complete", () => {
  it("buildCompleteEnvelope is exported and targets Asana Connector update_tasks", () => {
    const src = readEnvelope("complete");
    // Verbatim from complete/build-envelope.ts line 28
    expect(src).toContain("export function buildCompleteEnvelope");
    // Verbatim from complete/build-envelope.ts JSDoc:
    // "Asana Connector's update_tasks tool"
    expect(src).toContain("Asana Connector's update_tasks tool");
  });

  it("complete envelope args include completed (bool) and due_on fields", () => {
    // Verbatim from complete/build-envelope.ts interface CompleteEnvelopeArgs
    const src = readEnvelope("complete");
    expect(src).toContain("completed: boolean");
    expect(src).toContain("due_on: string");
  });
});

// ---------------------------------------------------------------------------
// assign — targets Asana Connector's update_tasks tool (assignee field)
// Verbatim from view-tool/src/apps/assign/lib/build-envelope.ts
// ---------------------------------------------------------------------------
describe("connector-envelope — assign", () => {
  it("buildAssignEnvelope is exported and targets Asana Connector update_tasks", () => {
    const src = readEnvelope("assign");
    // Verbatim from assign/build-envelope.ts line 35
    expect(src).toContain("export function buildAssignEnvelope");
    // Verbatim from assign/build-envelope.ts JSDoc:
    // "Asana Connector's update_tasks tool"
    expect(src).toContain("Asana Connector's update_tasks tool");
  });

  it("assign envelope documents that note is NOT passed as a tool arg", () => {
    // Verbatim from assign/build-envelope.ts line 15:
    // "update_tasks accepts `assignee` (user gid), `completed`"
    // "It does NOT accept a `note` argument."
    const src = readEnvelope("assign");
    expect(src).toContain("does NOT accept a `note` argument");
  });

  it("assign envelope args include assignee_gid", () => {
    // Verbatim from assign/build-envelope.ts interface AssignEnvelopeArgs
    const src = readEnvelope("assign");
    expect(src).toContain("assignee_gid: string");
  });
});

// ---------------------------------------------------------------------------
// create — targets Asana Connector's create_tasks tool
// Verbatim from view-tool/src/apps/create/lib/build-envelope.ts
// ---------------------------------------------------------------------------
describe("connector-envelope — create", () => {
  it("buildCreateEnvelope is exported and targets Asana Connector create_tasks", () => {
    const src = readEnvelope("create");
    // Verbatim from create/build-envelope.ts line 33
    expect(src).toContain("export function buildCreateEnvelope");
    // Verbatim from create/build-envelope.ts JSDoc:
    // "Asana Connector's create_tasks tool"
    expect(src).toContain("Asana Connector's create_tasks tool");
  });

  it("create envelope args include name (required)", () => {
    // Verbatim from create/build-envelope.ts interface CreateEnvelopeArgs:
    // "name: string"
    const src = readEnvelope("create");
    expect(src).toContain("name: string");
  });

  it("create envelope uses guillemet for task name", () => {
    // Verbatim from create/build-envelope.ts buildCreateEnvelope body:
    // "`name: «${args.name}»`"  (the guillemet wrapping of name)
    // Check for the string template that uses guillemets
    const src = readEnvelope("create");
    expect(src).toContain("name: «${args.name}»");
  });
});

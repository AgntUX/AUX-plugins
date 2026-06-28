/**
 * payload-shape.test.ts — agntux-zoom view-tool
 *
 * Lint-pass-11 E24/E25 guard: frozen-keyset and byte-budget assertions
 * for the agntux_zoom_save_doc_view handler.
 *
 * Calls viewTool.handle(args, ctx) with in-memory fixtures and asserts
 * the real structuredContent keyset and approximate payload byte size.
 *
 * Byte-budget cap (E24): the structuredContent JSON must stay under 64 KiB
 * per tool call (the remote MCP server's response budget).
 *
 * Frozen-keyset guard (E25): adding or removing a top-level key from
 * structuredContent is a breaking change for the UI component and must be
 * caught here.
 *
 * GOLDEN RULE: KEPT_KEYS and expected values are derived from reading
 * view-tool/src/agntux-zoom-view.ts — the handler's SaveDocPayload
 * TypeScript interface (lines 37-48) and the EMPTY_PAYLOAD constant
 * (lines 74-86). No prose-grep anywhere.
 *
 * Handler structuredContent keys (from agntux-zoom-view.ts SaveDocPayload):
 *   action_id, meeting_uuid, meeting_topic, meeting_date, participants,
 *   meeting_summary, action_items, draft_doc_title, draft_doc_body,
 *   open_in_zoom_url, personalization_signals
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline stub for ViewToolContext.
//
// The handler under test reads action files from ctx.fs.readFile(). We
// supply a mock that returns a pre-built action file body for the "populated"
// test, and throws for the "missing file" test. The mock signature matches
// what the handler calls: ctx.fs.readFile(path) → Buffer.
// ---------------------------------------------------------------------------

function makeFsCtx(
  files: Record<string, string>,
): import("@agntux/plugin-runtime").ViewToolContext {
  return {
    fs: {
      readFile: async (path: string) => {
        if (Object.prototype.hasOwnProperty.call(files, path)) {
          return Buffer.from(files[path], "utf8");
        }
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      },
    },
  } as unknown as import("@agntux/plugin-runtime").ViewToolContext;
}

// ---------------------------------------------------------------------------
// A minimal well-formed action file body with a ## Compose payload section.
// The fenced yaml block is what parseComposePayload() in agntux-zoom-view.ts
// extracts. All fields match SaveDocPayload's shape exactly.
// ---------------------------------------------------------------------------

const POPULATED_ACTION_BODY = `---
id: action-abc123
type: action
---

## Compose payload

\`\`\`yaml
meeting_uuid: "abc123XYZdef"
meeting_topic: "Q3 roadmap planning"
meeting_date: "June 24, 2026 at 2:00 PM EDT"
participants:
  - "Alice Chen"
  - "Bob Martinez"
  - "Trish Jordan"
meeting_summary: "Team reviewed the Q3 feature slate."
action_items:
  - "Trish: update the roadmap doc"
  - "Trish: share scope with stakeholders"
draft_doc_title: "Meeting summary — Q3 roadmap planning — June 24, 2026"
draft_doc_body: |
  # Q3 roadmap planning

  **Date:** June 24, 2026 at 2:00 PM EDT

  ## Summary

  Team reviewed the Q3 feature slate.

  ## Action items

  - Trish: update the roadmap doc
open_in_zoom_url: "https://zoom.us/rec/play/abc123XYZdef"
personalization_signals:
  - "Terse register — per user.md"
generated_at: "2026-06-24T18:30:00Z"
\`\`\`
`;

// ---------------------------------------------------------------------------
// Fixture: action file with NAMESPACED header "## Compose payload (zoom)"
// PLUS a DECOY bare "## Compose payload" carrying different sentinel values.
// This guards the fallback logic in agntux-zoom-view.ts:
//   extractFencedYaml(body, "Compose payload (zoom)") ?? extractFencedYaml(body, "Compose payload")
// The handler must pick the NAMESPACED block and ignore the decoy.
// ---------------------------------------------------------------------------

const NAMESPACED_ACTION_BODY = `---
id: action-ns123
type: action
---

## Compose payload (zoom)

\`\`\`yaml
meeting_uuid: "NAMESPACED_SENTINEL"
meeting_topic: "Namespaced roadmap session"
meeting_date: "June 28, 2026 at 10:00 AM CDT"
participants:
  - "NS Participant One"
meeting_summary: "Namespaced summary text."
action_items:
  - "NS: follow up on item"
draft_doc_title: "Namespaced doc title"
draft_doc_body: "Namespaced doc body text."
open_in_zoom_url: "https://zoom.us/rec/play/NAMESPACED_SENTINEL"
personalization_signals:
  - "NS signal"
generated_at: "2026-06-28T15:00:00Z"
\`\`\`

## Compose payload

\`\`\`yaml
meeting_uuid: "DECOY_SENTINEL"
meeting_topic: "Decoy topic"
meeting_date: "January 1, 2000 at 12:00 PM"
participants:
  - "Decoy Participant"
meeting_summary: "Decoy summary."
action_items:
  - "Decoy action item"
draft_doc_title: "Decoy doc title"
draft_doc_body: "Decoy doc body."
open_in_zoom_url: "https://zoom.us/rec/play/DECOY_SENTINEL"
personalization_signals:
  - "Decoy signal"
generated_at: "2000-01-01T00:00:00Z"
\`\`\`
`;

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

import viewToolModule from "../src/agntux-zoom-view.js";

function getSaveDocHandler() {
  const tool = viewToolModule.viewTools.find(
    (t) => t.descriptor.name === "agntux_zoom_save_doc_view",
  );
  if (!tool) throw new Error("Handler not found: agntux_zoom_save_doc_view");
  return tool;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAYLOAD_BUDGET_BYTES = 65_536; // 64 KiB

function byteSize(obj: unknown): number {
  return Buffer.byteLength(JSON.stringify(obj), "utf-8");
}

// The complete set of top-level keys the handler must always return.
// Derived from agntux-zoom-view.ts SaveDocPayload interface (lines 37-48).
const KEPT_KEYS = [
  "action_id",
  "meeting_uuid",
  "meeting_topic",
  "meeting_date",
  "participants",
  "meeting_summary",
  "action_items",
  "draft_doc_title",
  "draft_doc_body",
  "open_in_zoom_url",
  "personalization_signals",
];

// ---------------------------------------------------------------------------
// Handler: agntux_zoom_save_doc_view — empty-args (render-harness) path
// ---------------------------------------------------------------------------

describe("agntux_zoom_save_doc_view — empty-args (render-harness) path", () => {
  it("empty-args call returns all 11 required keys with empty/array values", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({});
    const result = await handler.handle({}, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(sc).sort()).toEqual(KEPT_KEYS.slice().sort());
  });

  it("empty-args: action_id is empty string", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({});
    const result = await handler.handle({}, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("");
  });

  it("empty-args: participants is an empty array", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({});
    const result = await handler.handle({}, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Array.isArray(sc.participants)).toBe(true);
    expect((sc.participants as unknown[]).length).toBe(0);
  });

  it("empty-args: action_items is an empty array", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({});
    const result = await handler.handle({}, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Array.isArray(sc.action_items)).toBe(true);
    expect((sc.action_items as unknown[]).length).toBe(0);
  });

  it("empty-args: personalization_signals is an empty array", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({});
    const result = await handler.handle({}, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Array.isArray(sc.personalization_signals)).toBe(true);
    expect((sc.personalization_signals as unknown[]).length).toBe(0);
  });

  it("empty-args: string fields are empty strings", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({});
    const result = await handler.handle({}, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    for (const key of [
      "meeting_uuid",
      "meeting_topic",
      "meeting_date",
      "meeting_summary",
      "draft_doc_title",
      "draft_doc_body",
      "open_in_zoom_url",
    ]) {
      expect(sc[key], `${key} should be empty string`).toBe("");
    }
  });

  it("never throws — render-harness contract", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({});
    await expect(handler.handle({}, ctx)).resolves.toBeDefined();
    await expect(handler.handle({ action_id: "" }, ctx)).resolves.toBeDefined();
    await expect(handler.handle({ action_id: null }, ctx)).resolves.toBeDefined();
  });

  it("content[0].type is text", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({});
    const result = await handler.handle({}, ctx);
    expect(result.content[0].type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Handler: agntux_zoom_save_doc_view — missing action file path
// (action_id provided but file doesn't exist on fs)
// ---------------------------------------------------------------------------

describe("agntux_zoom_save_doc_view — missing action file (fs ENOENT)", () => {
  it("returns degraded payload with action_id and empty string fields", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({}); // no files — readFile always throws
    const result = await handler.handle({ action_id: "action-xyz" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    // Key set must be complete even on error.
    expect(Object.keys(sc).sort()).toEqual(KEPT_KEYS.slice().sort());
    // action_id is preserved from the arg.
    expect(sc.action_id).toBe("action-xyz");
    // All string fields are empty strings.
    expect(sc.meeting_uuid).toBe("");
    expect(sc.draft_doc_title).toBe("");
  });

  it("never throws on ENOENT — degrades cleanly", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({});
    await expect(
      handler.handle({ action_id: "action-does-not-exist" }, ctx),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Handler: agntux_zoom_save_doc_view — populated action file path
// ---------------------------------------------------------------------------

describe("agntux_zoom_save_doc_view — populated action file", () => {
  it("returns all 11 keys from the parsed compose payload", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({
      "actions/action-abc123.md": POPULATED_ACTION_BODY,
    });
    const result = await handler.handle({ action_id: "action-abc123" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(sc).sort()).toEqual(KEPT_KEYS.slice().sort());
  });

  it("action_id is preserved from the arg", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({
      "actions/action-abc123.md": POPULATED_ACTION_BODY,
    });
    const result = await handler.handle({ action_id: "action-abc123" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("action-abc123");
  });

  it("string fields are populated from the compose payload", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({
      "actions/action-abc123.md": POPULATED_ACTION_BODY,
    });
    const result = await handler.handle({ action_id: "action-abc123" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.meeting_uuid).toBe("abc123XYZdef");
    expect(sc.meeting_topic).toBe("Q3 roadmap planning");
    expect(sc.meeting_date).toBe("June 24, 2026 at 2:00 PM EDT");
    expect(sc.meeting_summary).toBe("Team reviewed the Q3 feature slate.");
    expect(sc.open_in_zoom_url).toBe("https://zoom.us/rec/play/abc123XYZdef");
  });

  it("participants array is populated with string entries", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({
      "actions/action-abc123.md": POPULATED_ACTION_BODY,
    });
    const result = await handler.handle({ action_id: "action-abc123" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    const participants = sc.participants as string[];
    expect(Array.isArray(participants)).toBe(true);
    expect(participants.length).toBe(3);
    expect(participants).toContain("Alice Chen");
    expect(participants).toContain("Bob Martinez");
    expect(participants).toContain("Trish Jordan");
  });

  it("action_items array is populated with string entries", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({
      "actions/action-abc123.md": POPULATED_ACTION_BODY,
    });
    const result = await handler.handle({ action_id: "action-abc123" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    const actionItems = sc.action_items as string[];
    expect(Array.isArray(actionItems)).toBe(true);
    expect(actionItems.length).toBe(2);
    expect(actionItems[0]).toBe("Trish: update the roadmap doc");
  });

  it("personalization_signals array is populated from payload", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({
      "actions/action-abc123.md": POPULATED_ACTION_BODY,
    });
    const result = await handler.handle({ action_id: "action-abc123" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    const signals = sc.personalization_signals as string[];
    expect(Array.isArray(signals)).toBe(true);
    expect(signals.length).toBe(1);
    expect(signals[0]).toBe("Terse register — per user.md");
  });

  it("structuredContent keyset is frozen — exactly 11 top-level keys (E25)", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({
      "actions/action-abc123.md": POPULATED_ACTION_BODY,
    });
    const result = await handler.handle({ action_id: "action-abc123" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(sc).sort()).toEqual(KEPT_KEYS.slice().sort());
  });

  it("payload with long meeting summary and action items is within 64 KiB (E24)", async () => {
    const handler = getSaveDocHandler();
    // Build a large-ish action body: long meeting summary, many action items,
    // and a large draft_doc_body to stress the byte budget.
    const largeDraftBody = "# Meeting\n\n" + "Content line.\n".repeat(100);
    const largeBody = `---
id: action-large
type: action
---

## Compose payload

\`\`\`yaml
meeting_uuid: "abc123"
meeting_topic: "Large Meeting"
meeting_date: "June 24, 2026 at 2:00 PM EDT"
participants:
${Array.from({ length: 10 }, (_, i) => `  - "Participant ${i}"`).join("\n")}
meeting_summary: "${"Summary text. ".repeat(30)}"
action_items:
${Array.from({ length: 20 }, (_, i) => `  - "Action item ${i}: do something important"`).join("\n")}
draft_doc_title: "Meeting summary — Large Meeting — June 24, 2026"
draft_doc_body: |
${largeDraftBody
  .split("\n")
  .map((line) => `  ${line}`)
  .join("\n")}
open_in_zoom_url: "https://zoom.us/rec/play/abc123"
personalization_signals:
  - "Terse register — per user.md"
  - "Use bullet points — per user.md"
generated_at: "2026-06-24T18:30:00Z"
\`\`\`
`;
    const ctx = makeFsCtx({ "actions/action-large.md": largeBody });
    const result = await handler.handle({ action_id: "action-large" }, ctx);
    expect(byteSize(result.structuredContent)).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });
});

// ---------------------------------------------------------------------------
// Handler: agntux_zoom_save_doc_view — namespaced "## Compose payload (zoom)"
// regression guard: namespaced header wins over bare "## Compose payload" decoy
// ---------------------------------------------------------------------------

describe('agntux_zoom_save_doc_view — namespaced "Compose payload (zoom)" wins over bare decoy', () => {
  it("reads NAMESPACED values, not DECOY_SENTINEL, when both sections are present", async () => {
    const handler = getSaveDocHandler();
    const ctx = makeFsCtx({
      "actions/action-ns123.md": NAMESPACED_ACTION_BODY,
    });
    const result = await handler.handle({ action_id: "action-ns123" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;

    // Must reflect the namespaced block.
    expect(sc.meeting_uuid).toBe("NAMESPACED_SENTINEL");
    expect(sc.meeting_topic).toBe("Namespaced roadmap session");
    expect(sc.open_in_zoom_url).toBe("https://zoom.us/rec/play/NAMESPACED_SENTINEL");

    // Must NOT reflect the decoy bare block.
    expect(sc.meeting_uuid).not.toBe("DECOY_SENTINEL");
    expect(sc.open_in_zoom_url).not.toBe("https://zoom.us/rec/play/DECOY_SENTINEL");
  });
});

// ---------------------------------------------------------------------------
// Module-level invariants — one tool registered
// ---------------------------------------------------------------------------

describe("view-tool module", () => {
  it("exports exactly 1 view tool", () => {
    expect(viewToolModule.viewTools.length).toBe(1);
  });

  it("tool name is agntux_zoom_save_doc_view", () => {
    const names = viewToolModule.viewTools.map((t) => t.descriptor.name);
    expect(names).toContain("agntux_zoom_save_doc_view");
  });

  it("tool descriptor has a ui_resource_uri", () => {
    const handler = getSaveDocHandler();
    expect(handler.descriptor.ui_resource_uri).toBeTruthy();
  });

  it("save-doc tool ui_resource_uri is ui://agntux-zoom/save-doc", () => {
    const handler = getSaveDocHandler();
    // Verbatim from agntux-zoom-view.ts line 27:
    // 'const RESOURCE_URI = "ui://agntux-zoom/save-doc" as const;'
    expect(handler.descriptor.ui_resource_uri).toBe("ui://agntux-zoom/save-doc");
  });

  it("tool inputSchema requires action_id", () => {
    const handler = getSaveDocHandler();
    const schema = handler.descriptor.inputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toContain("action_id");
    expect(Object.prototype.hasOwnProperty.call(schema.properties, "action_id")).toBe(true);
  });

  it("tool outputSchema lists all 11 structuredContent keys as required", () => {
    const handler = getSaveDocHandler();
    const outputSchema = handler.descriptor.outputSchema as {
      required: string[];
    };
    for (const key of KEPT_KEYS) {
      expect(outputSchema.required, `outputSchema.required missing ${key}`).toContain(key);
    }
  });
});

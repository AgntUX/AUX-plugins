/**
 * connector-envelope.test.ts — agntux-notion
 *
 * Static assertions that each of the three view-tool write-back paths emits
 * a connector-targeted envelope via sendFollowUpMessage and suppresses the
 * Notion Connector's native MCP App UI.
 *
 * Handlers:
 *   comment  (reply-comment)  → view-tool/src/apps/comment/lib/build-envelope.ts
 *   update   (update-page)    → view-tool/src/apps/update/lib/build-envelope.ts
 *   create   (create-page)    → view-tool/src/apps/create/lib/build-envelope.ts
 *
 * All assertions derive from verbatim substrings present in the authored source files.
 * No LLM is invoked at test time.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const VT_ROOT = join(PLUGIN_ROOT, "view-tool");

function readEnvelopeBuilder(handler: "comment" | "update" | "create"): string {
  return readFileSync(
    join(VT_ROOT, `src/apps/${handler}/lib/build-envelope.ts`),
    "utf-8",
  );
}

function readMainComponent(handler: "comment" | "update" | "create"): string {
  const names: Record<string, string> = {
    comment: "CommentMainComponent",
    update: "UpdateMainComponent",
    create: "CreateMainComponent",
  };
  return readFileSync(
    join(VT_ROOT, `src/apps/${handler}/${names[handler]}.tsx`),
    "utf-8",
  );
}

function readApp(handler: "comment" | "update" | "create"): string {
  const names: Record<string, string> = {
    comment: "CommentApp",
    update: "UpdateApp",
    create: "CreateApp",
  };
  return readFileSync(
    join(VT_ROOT, `src/apps/${handler}/${names[handler]}.tsx`),
    "utf-8",
  );
}

// ── Envelope builder files exist ───────────────────────────────────────────────

describe("envelope builder files exist", () => {
  for (const handler of ["comment", "update", "create"] as const) {
    it(`view-tool/src/apps/${handler}/lib/build-envelope.ts exists`, () => {
      expect(
        existsSync(join(VT_ROOT, `src/apps/${handler}/lib/build-envelope.ts`)),
      ).toBe(true);
    });
  }
});

// ── comment handler: reply-to-comment envelope ────────────────────────────────

describe("comment handler — notion-create-comment connector envelope", () => {
  const src = readEnvelopeBuilder("comment");

  it("envelope builder addresses the Notion Connector (verbatim phrase)", () => {
    // Verbatim from comment/lib/build-envelope.ts line 44
    expect(src).toContain("Use the Notion Connector to post a comment reply on a Notion page.");
  });

  it("envelope builder includes page_id and discussion_id in the envelope", () => {
    // Verbatim from comment/lib/build-envelope.ts line 47
    expect(src).toContain("page_id: ${pageId}, discussion_id: ${discussionId}");
  });

  it("envelope builder suppresses native Notion Connector UI (NO_NATIVE_UI_DIRECTIVE)", () => {
    // Verbatim from comment/lib/build-envelope.ts line 23-28
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
    expect(src).toContain("do NOT render any Notion");
    expect(src).toContain("Connector MCP App UI for this call");
  });

  it("envelope builder escapes guillemet delimiters in body text", () => {
    // Verbatim from comment/lib/build-envelope.ts line 17
    expect(src).toContain("escapeBody");
    expect(src).toContain("Body: «${escaped}»");
  });

  it("CommentMainComponent calls sendFollowUpMessage with the built envelope", () => {
    const main = readMainComponent("comment");
    // Verbatim from CommentMainComponent.tsx line 75
    expect(main).toContain("const envelope = buildEnvelope(");
    expect(main).toContain("await sendFollowUpMessage(envelope)");
  });

  it("CommentMainComponent handleSend is an async function", () => {
    const main = readMainComponent("comment");
    // Verbatim from CommentMainComponent.tsx line 61
    expect(main).toContain("const handleSend = async () => {");
  });
});

// ── update handler: update-page envelope ─────────────────────────────────────

describe("update handler — notion-update-page connector envelope", () => {
  const src = readEnvelopeBuilder("update");

  it("envelope builder addresses the Notion Connector", () => {
    // Verbatim from update/lib/build-envelope.ts line 37
    expect(src).toContain("Use the Notion Connector to update properties on a Notion page.");
  });

  it("envelope builder includes page_id in the envelope", () => {
    // Verbatim from update/lib/build-envelope.ts line 38
    expect(src).toContain("page_id: ${pageId}");
  });

  it("envelope builder serialises properties as JSON", () => {
    // Verbatim from update/lib/build-envelope.ts line 35-39
    expect(src).toContain("JSON.stringify(properties)");
    expect(src).toContain("Apply the following property changes: ${propsJson}");
  });

  it("envelope builder suppresses native Notion Connector UI", () => {
    // Verbatim from update/lib/build-envelope.ts
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
    expect(src).toContain("do NOT render any Notion");
  });

  it("UpdateMainComponent calls sendFollowUpMessage with the built envelope", () => {
    const main = readMainComponent("update");
    // Verbatim from UpdateMainComponent.tsx
    expect(main).toContain("const envelope = buildEnvelope(");
    expect(main).toContain("await sendFollowUpMessage(envelope)");
  });

  it("UpdateMainComponent handleSave is an async function", () => {
    const main = readMainComponent("update");
    // Verbatim from UpdateMainComponent.tsx line 104
    expect(main).toContain("const handleSave = async () => {");
  });
});

// ── create handler: create-page envelope ─────────────────────────────────────

describe("create handler — notion-create-pages connector envelope", () => {
  const src = readEnvelopeBuilder("create");

  it("envelope builder addresses the Notion Connector", () => {
    // Verbatim from create/lib/build-envelope.ts line 48
    expect(src).toContain("Use the Notion Connector to create a new Notion page.");
  });

  it("envelope builder includes parent_id and title in the envelope", () => {
    // Verbatim from create/lib/build-envelope.ts line 49
    expect(src).toContain("parent_id: ${parentId} (${parentLabel}), title: «${escapedTitle}»");
  });

  it("envelope builder escapes guillemet delimiters in title and body", () => {
    // Verbatim from create/lib/build-envelope.ts lines 16-17, 44-46
    expect(src).toContain("escapeBody");
    expect(src).toContain("Body: «${escapedBody}»");
  });

  it("envelope builder suppresses native Notion Connector UI", () => {
    // Verbatim from create/lib/build-envelope.ts
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
    expect(src).toContain("do NOT render any Notion");
  });

  it("CreateMainComponent calls sendFollowUpMessage with the built envelope", () => {
    const main = readMainComponent("create");
    // Verbatim from CreateMainComponent.tsx
    expect(main).toContain("const envelope = buildEnvelope(");
    expect(main).toContain("await sendFollowUpMessage(envelope)");
  });

  it("CreateMainComponent handleCreate is an async function", () => {
    const main = readMainComponent("create");
    // Verbatim from CreateMainComponent.tsx line 100
    expect(main).toContain("const handleCreate = async () => {");
  });
});

// ── App.tsx error-envelope short-circuit ──────────────────────────────────────

describe("App.tsx error-envelope short-circuit (all three handlers)", () => {
  for (const handler of ["comment", "update", "create"] as const) {
    it(`${handler} App.tsx short-circuits on detectErrorEnvelope`, () => {
      const app = readApp(handler);
      // Verbatim from all three *App.tsx files — lines 58-67
      expect(app).toContain("detectErrorEnvelope");
      expect(app).toContain("ServerErrorScreen");
    });

    it(`${handler} App.tsx imports detectErrorEnvelope and ServerErrorScreen from @agntux/ui-primitives`, () => {
      const app = readApp(handler);
      // Verbatim from all three *App.tsx files — line 19
      // (import uses double quotes: from "@agntux/ui-primitives")
      expect(app).toContain('from "@agntux/ui-primitives"');
      expect(app).toContain("ServerErrorScreen");
      expect(app).toContain("detectErrorEnvelope");
    });
  }
});

// ── view-tool module exports all three handlers ───────────────────────────────

describe("view-tool module exports", () => {
  const vtSrc = readFileSync(
    join(VT_ROOT, "src/agntux-notion-view.ts"),
    "utf-8",
  );

  it("agntux-notion-view.ts exports agntux_notion_comment_view", () => {
    // Verbatim from agntux-notion-view.ts line 107
    expect(vtSrc).toContain(`name: "agntux_notion_comment_view"`);
  });

  it("agntux-notion-view.ts exports agntux_notion_update_view", () => {
    // Verbatim from agntux-notion-view.ts line 224
    expect(vtSrc).toContain(`name: "agntux_notion_update_view"`);
  });

  it("agntux-notion-view.ts exports agntux_notion_create_view", () => {
    // Verbatim from agntux-notion-view.ts line 328
    expect(vtSrc).toContain(`name: "agntux_notion_create_view"`);
  });

  it("agntux-notion-view.ts viewTools array contains all three handlers", () => {
    // Verbatim from agntux-notion-view.ts line 374
    expect(vtSrc).toContain("viewTools: [commentViewTool, updateViewTool, createViewTool]");
  });
});

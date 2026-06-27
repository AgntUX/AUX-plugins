// =============================================================================
// payload-shape.test.ts — payload-shape regression guard for agntux-notion.
//
// Exercises all three view tools via their handler functions (loaded from
// src/agntux-notion-view.ts). All I/O goes through an in-memory fs shim;
// no real filesystem is touched.
//
// Key sets derived from the outputSchema declared in agntux-notion-view.ts:
//   comment view  → action_id, page_id, discussion_id, page_url, page_title,
//                    comment_thread, draft_body, personalization_signals
//   update view   → action_id, page_id, page_url, page_title,
//                    current_properties, editable_properties
//   create view   → action_id, parent_options, draft_title, draft_body
//
// These key sets are read directly from the outputSchema.required arrays
// in agntux-notion-view.ts — not from prose, not from override files.
//
// PAYLOAD_BUDGET_BYTES = 32 KB (single-row views; well below the 64 KB host cap).
//
// Pass 11 (E24/E25) of the marketplace linter requires a Buffer.byteLength +
// JSON.stringify + toBeLessThan assertion in this file.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
} from "@agntux/plugin-runtime";
import { ViewToolFsError } from "@agntux/plugin-runtime";
import mod from "../src/agntux-notion-view.js";

// ── Budget ────────────────────────────────────────────────────────────────────

// 32 KB per single-row view — well below the 64 KB host cap.
const PAYLOAD_BUDGET_BYTES = 32 * 1024;

// ── structuredContent key sets (derived from outputSchema in agntux-notion-view.ts) ──

// From commentViewTool.descriptor.outputSchema.required (line 143):
const COMMENT_KEYS = new Set([
  "action_id",
  "page_id",
  "discussion_id",
  "page_url",
  "page_title",
  "comment_thread",
  "draft_body",
  "personalization_signals",
]);

// From updateViewTool.descriptor.outputSchema.required (line 257):
const UPDATE_KEYS = new Set([
  "action_id",
  "page_id",
  "page_url",
  "page_title",
  "current_properties",
  "editable_properties",
]);

// From createViewTool.descriptor.outputSchema.required (line 360):
const CREATE_KEYS = new Set([
  "action_id",
  "parent_options",
  "draft_title",
  "draft_body",
]);

// ── In-memory fs ─────────────────────────────────────────────────────────────

function inMemoryFs(files: Record<string, string>): ViewToolFs {
  return {
    async readFile(path: string) {
      const content = files[path];
      if (content == null) throw new ViewToolFsError("not-found", path);
      return Buffer.from(content, "utf8");
    },
    async readMany(paths: string[]) {
      return paths.map((p) => {
        const c = files[p];
        return c != null ? Buffer.from(c, "utf8") : null;
      });
    },
    async list(prefix: string) {
      return Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .sort();
    },
    async listWithMeta(prefix: string): Promise<ListWithMetaEntry[]> {
      return Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((path) => ({ path, meta: null }));
    },
    async exists(path: string) {
      return Object.prototype.hasOwnProperty.call(files, path);
    },
  };
}

// ── Context factory ──────────────────────────────────────────────────────────

function makeCtx(files: Record<string, string>): ViewToolContext {
  const ctx: ViewToolContext = {
    fs: inMemoryFs(files),
    scope: { user_id: "test-user", organization_id: "test-org" },
    now: () => new Date("2026-06-26T14:00:00Z"),
    log: (_level, _msg, _fields?) => undefined,
    withScope: (_extra) => makeCtx(files),
  };
  return ctx;
}

// ── Action file builders ──────────────────────────────────────────────────────

/** Build a valid comment-reply action frontmatter. */
function makeCommentAction(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: high
type: action-item
schema_version: "1.0.0"
source: notion
source_id: notion:1a2b3c4d-5e6f-7890-abcd-ef1234567890
page_id: "1a2b3c4d-5e6f-7890-abcd-ef1234567890"
discussion_id: "a1b2c3d4-e5f6-7890-1234-567890abcdef"
page_url: "https://www.notion.so/Engineering-Wiki-1a2b3c4d5e6f7890abcdef1234567890"
title: "Engineering Wiki"
comment_thread: "Alice: Can you review the deployment checklist?"
draft_body: "Sure, I'll take a look today."
personalization_signals: "Alice is your direct report. The checklist affects your team."
---

## Why this matters

Alice asked you to review the deployment checklist in the Engineering Wiki.
`;
}

/** Build a valid update-page action frontmatter. */
function makeUpdateAction(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: medium
type: action-item
schema_version: "1.0.0"
source: notion
source_id: notion:9f8e7d6c-5b4a-3210-fedc-ba9876543210
page_id: "9f8e7d6c-5b4a-3210-fedc-ba9876543210"
page_url: "https://www.notion.so/API-Migration-9f8e7d6c5b4a3210fedcba9876543210"
title: "API Migration"
current_properties: "Status: In Progress\\nDue: 2026-07-01\\nAssignee: John Jordan"
editable_properties: '[{"key":"status","type":"select","label":"Status","value":"In Progress","options":["Not started","In Progress","Done"]},{"key":"due_date","type":"date","label":"Due date","value":"2026-07-01"}]'
---

## Why this matters

The API Migration task is past its milestone date.
`;
}

/** Build a valid create-page action frontmatter + body. */
function makeCreateAction(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: low
type: action-item
schema_version: "1.0.0"
source: notion
parent_options: '[{"id":"1a2b3c4d-5e6f-7890-abcd-ef1234567890","label":"Engineering Wiki"},{"id":"9f8e7d6c-5b4a-3210-fedc-ba9876543210","label":"Projects"}]'
draft_title: "Deployment Checklist Review"
---

## Draft body

Document the deployment checklist items discussed in today's standup.
`;
}

// ── Handler references ────────────────────────────────────────────────────────

// mod.viewTools order mirrors listing.yaml ui_components order:
//   [0] agntux_notion_comment_view
//   [1] agntux_notion_update_view
//   [2] agntux_notion_create_view
const commentTool = mod.viewTools[0]!;
const updateTool = mod.viewTools[1]!;
const createTool = mod.viewTools[2]!;

// ── Key-set assertion helper ──────────────────────────────────────────────────

function assertKeySet(
  sc: Record<string, unknown>,
  expected: Set<string>,
  label: string,
) {
  const keys = new Set(Object.keys(sc));
  for (const k of keys) {
    expect(expected.has(k), `unexpected key "${k}" in ${label} structuredContent`).toBe(true);
  }
  for (const k of expected) {
    expect(keys.has(k), `missing required key "${k}" in ${label} structuredContent`).toBe(true);
  }
}

// =============================================================================
// COMMENT VIEW (agntux_notion_comment_view)
// =============================================================================

describe("agntux_notion_comment_view payload shape", () => {
  it("descriptor name is agntux_notion_comment_view", () => {
    // Derived from agntux-notion-view.ts line 107
    expect(commentTool.descriptor.name).toBe("agntux_notion_comment_view");
  });

  it("descriptor ui_resource_uri is ui://agntux-notion/reply-comment", () => {
    // Derived from agntux-notion-view.ts COMMENT_RESOURCE_URI (line 26)
    expect(commentTool.descriptor.ui_resource_uri).toBe("ui://agntux-notion/reply-comment");
  });

  it("returns all 8 required keys on empty action_id (empty-string args)", async () => {
    const result = await commentTool.handle({ action_id: "" }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, COMMENT_KEYS, "comment (empty action_id)");
    expect(sc.action_id).toBe("");
  });

  it("returns all 8 required keys and correct values for a valid action file", async () => {
    const actionId = "notion-comment-001";
    const files = { [`actions/${actionId}.md`]: makeCommentAction(actionId) };
    const result = await commentTool.handle({ action_id: actionId }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, COMMENT_KEYS, "comment (valid)");
    expect(sc.action_id).toBe(actionId);
    expect(sc.page_id).toBe("1a2b3c4d-5e6f-7890-abcd-ef1234567890");
    expect(sc.discussion_id).toBe("a1b2c3d4-e5f6-7890-1234-567890abcdef");
    expect(sc.page_title).toBe("Engineering Wiki");
    expect(sc.comment_thread).toBe("Alice: Can you review the deployment checklist?");
    expect(sc.draft_body).toBe("Sure, I'll take a look today.");
  });

  it("degrades to empty-field payload (with action_id set) when action file is missing", async () => {
    const result = await commentTool.handle(
      { action_id: "no-such-action" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, COMMENT_KEYS, "comment (missing file)");
    // Falls back to action_id as page_id per handler comment (line 86)
    expect(sc.action_id).toBe("no-such-action");
    expect(sc.discussion_id).toBe("");
    expect(sc.page_url).toBe("");
  });

  it("page_id falls back to action_id when fm.page_id is absent", async () => {
    // Action file with no page_id frontmatter key
    const actionId = "no-page-id";
    const files = {
      [`actions/${actionId}.md`]: `---\nid: ${actionId}\nstatus: open\ntitle: "Test"\n---\n\n## Body\n`,
    };
    const result = await commentTool.handle({ action_id: actionId }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    // Verbatim from agntux-notion-view.ts line 86: "s(fm.page_id) || actionId"
    expect(sc.page_id).toBe(actionId);
  });

  it("payload is within 32 KB budget", async () => {
    const actionId = "notion-comment-budget";
    const files = { [`actions/${actionId}.md`]: makeCommentAction(actionId) };
    const result = await commentTool.handle({ action_id: actionId }, makeCtx(files));
    const bytes = Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("content[] carries a text explanation referencing the iframe", () => {
    // renderConfirmationText always mentions the iframe/MCP App host
    // but we only assert the structure — one text item
    const runAndCheck = async () => {
      const result = await commentTool.handle({ action_id: "" }, makeCtx({}));
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]?.type).toBe("text");
      expect(typeof result.content[0]?.text).toBe("string");
    };
    return runAndCheck();
  });
});

// =============================================================================
// UPDATE VIEW (agntux_notion_update_view)
// =============================================================================

describe("agntux_notion_update_view payload shape", () => {
  it("descriptor name is agntux_notion_update_view", () => {
    // Derived from agntux-notion-view.ts line 224
    expect(updateTool.descriptor.name).toBe("agntux_notion_update_view");
  });

  it("descriptor ui_resource_uri is ui://agntux-notion/update-page", () => {
    // Derived from agntux-notion-view.ts UPDATE_RESOURCE_URI (line 156)
    expect(updateTool.descriptor.ui_resource_uri).toBe("ui://agntux-notion/update-page");
  });

  it("returns all 6 required keys on empty action_id", async () => {
    const result = await updateTool.handle({ action_id: "" }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, UPDATE_KEYS, "update (empty action_id)");
    expect(sc.action_id).toBe("");
  });

  it("returns all 6 required keys and correct values for a valid action file", async () => {
    const actionId = "notion-update-001";
    const files = { [`actions/${actionId}.md`]: makeUpdateAction(actionId) };
    const result = await updateTool.handle({ action_id: actionId }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, UPDATE_KEYS, "update (valid)");
    expect(sc.action_id).toBe(actionId);
    expect(sc.page_id).toBe("9f8e7d6c-5b4a-3210-fedc-ba9876543210");
    expect(sc.page_title).toBe("API Migration");
    expect(sc.current_properties).toContain("Status: In Progress");
    expect(typeof sc.editable_properties).toBe("string");
  });

  it("degrades to empty-field payload (with action_id set) when action file is missing", async () => {
    const result = await updateTool.handle(
      { action_id: "no-such-update" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, UPDATE_KEYS, "update (missing file)");
    expect(sc.action_id).toBe("no-such-update");
    expect(sc.page_url).toBe("");
    expect(sc.current_properties).toBe("");
  });

  it("page_id falls back to action_id when fm.page_id is absent", async () => {
    const actionId = "upd-no-page-id";
    const files = {
      [`actions/${actionId}.md`]: `---\nid: ${actionId}\nstatus: open\ntitle: "Test"\n---\n`,
    };
    const result = await updateTool.handle({ action_id: actionId }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    // Verbatim from agntux-notion-view.ts line 208: "s(fm.page_id) || actionId"
    expect(sc.page_id).toBe(actionId);
  });

  it("payload is within 32 KB budget", async () => {
    const actionId = "notion-update-budget";
    const files = { [`actions/${actionId}.md`]: makeUpdateAction(actionId) };
    const result = await updateTool.handle({ action_id: actionId }, makeCtx(files));
    const bytes = Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("content[] carries a text explanation", async () => {
    const result = await updateTool.handle({ action_id: "" }, makeCtx({}));
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    expect(typeof result.content[0]?.text).toBe("string");
  });
});

// =============================================================================
// CREATE VIEW (agntux_notion_create_view)
// =============================================================================

describe("agntux_notion_create_view payload shape", () => {
  it("descriptor name is agntux_notion_create_view", () => {
    // Derived from agntux-notion-view.ts line 328
    expect(createTool.descriptor.name).toBe("agntux_notion_create_view");
  });

  it("descriptor ui_resource_uri is ui://agntux-notion/create-page", () => {
    // Derived from agntux-notion-view.ts CREATE_RESOURCE_URI (line 270)
    expect(createTool.descriptor.ui_resource_uri).toBe("ui://agntux-notion/create-page");
  });

  it("returns all 4 required keys on empty action_id", async () => {
    const result = await createTool.handle({ action_id: "" }, makeCtx({}));
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, CREATE_KEYS, "create (empty action_id)");
    expect(sc.action_id).toBe("");
  });

  it("returns all 4 required keys and correct values for a valid action file", async () => {
    const actionId = "notion-create-001";
    const files = { [`actions/${actionId}.md`]: makeCreateAction(actionId) };
    const result = await createTool.handle({ action_id: actionId }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, CREATE_KEYS, "create (valid)");
    expect(sc.action_id).toBe(actionId);
    expect(sc.draft_title).toBe("Deployment Checklist Review");
    expect(typeof sc.parent_options).toBe("string");
    // The body is the markdown body after the frontmatter
    expect(typeof sc.draft_body).toBe("string");
    expect((sc.draft_body as string).length).toBeGreaterThan(0);
  });

  it("draft_title falls back to fm.title when fm.draft_title is absent", async () => {
    // Verbatim from agntux-notion-view.ts line 314: "s(fm.draft_title) || s(fm.title)"
    const actionId = "create-title-fallback";
    const files = {
      [`actions/${actionId}.md`]: `---\nid: ${actionId}\nstatus: open\ntitle: "Fallback Title"\n---\n\nBody text here.\n`,
    };
    const result = await createTool.handle({ action_id: actionId }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.draft_title).toBe("Fallback Title");
  });

  it("degrades to empty-field payload (with action_id set) when action file is missing", async () => {
    const result = await createTool.handle(
      { action_id: "no-such-create" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    assertKeySet(sc, CREATE_KEYS, "create (missing file)");
    expect(sc.action_id).toBe("no-such-create");
    expect(sc.parent_options).toBe("");
    expect(sc.draft_title).toBe("");
  });

  it("payload is within 32 KB budget", async () => {
    const actionId = "notion-create-budget";
    const files = { [`actions/${actionId}.md`]: makeCreateAction(actionId) };
    const result = await createTool.handle({ action_id: actionId }, makeCtx(files));
    const bytes = Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("payload stays within 32 KB budget even with a 5 000-char draft body", async () => {
    const actionId = "notion-create-long-body";
    const longBody = "y".repeat(5000);
    const files = {
      [`actions/${actionId}.md`]: `---\nid: ${actionId}\nstatus: open\ndraft_title: "Long draft"\nparent_options: '[{"id":"abc","label":"Wiki"}]'\n---\n\n${longBody}\n`,
    };
    const result = await createTool.handle({ action_id: actionId }, makeCtx(files));
    const bytes = Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("content[] carries a text explanation", async () => {
    const result = await createTool.handle({ action_id: "" }, makeCtx({}));
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    expect(typeof result.content[0]?.text).toBe("string");
  });
});

// =============================================================================
// All three handlers survive ctx.fs errors without throwing
// =============================================================================

describe("all handlers degrade gracefully on ctx.fs errors", () => {
  const tools = [
    { name: "agntux_notion_comment_view", tool: commentTool, keys: COMMENT_KEYS },
    { name: "agntux_notion_update_view", tool: updateTool, keys: UPDATE_KEYS },
    { name: "agntux_notion_create_view", tool: createTool, keys: CREATE_KEYS },
  ] as const;

  for (const { name, tool, keys } of tools) {
    it(`${name}: does not throw when ctx.fs.readFile throws an unexpected error`, async () => {
      const ctx = makeCtx({});
      ctx.fs.readFile = async () => {
        throw new Error("backend unavailable");
      };
      const result = await tool.handle({ action_id: "any-id" }, ctx);
      const sc = result.structuredContent as Record<string, unknown>;
      assertKeySet(sc, keys, name);
      const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
      expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    });
  }
});

// =============================================================================
// viewTools module export shape
// =============================================================================

describe("module export shape", () => {
  it("mod.viewTools has exactly 3 entries", () => {
    expect(mod.viewTools).toHaveLength(3);
  });

  it("viewTools[0].descriptor.name is agntux_notion_comment_view", () => {
    expect(mod.viewTools[0]!.descriptor.name).toBe("agntux_notion_comment_view");
  });

  it("viewTools[1].descriptor.name is agntux_notion_update_view", () => {
    expect(mod.viewTools[1]!.descriptor.name).toBe("agntux_notion_update_view");
  });

  it("viewTools[2].descriptor.name is agntux_notion_create_view", () => {
    expect(mod.viewTools[2]!.descriptor.name).toBe("agntux_notion_create_view");
  });
});

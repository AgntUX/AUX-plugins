// =============================================================================
// payload-shape.test.ts — regression guard for agntux-slack view-tool.
//
// Mirrors the agntux-core pattern in plugins/agntux-core/view-tool/__tests__/
// payload-shape.test.ts. Exercises handleCompose and handleCanvas via the
// exported ViewTool entries; all I/O goes through an in-memory fs shim.
//
// Does NOT test the iframe entry (compose-ui.tsx / canvas-ui.tsx) directly —
// those are React+DOM modules that require a real browser environment. The
// protocol integration is covered by SimpleMcpApp's own unit tests.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
  ViewToolScope,
} from "@agntux/plugin-runtime";
import { ViewToolFsError } from "@agntux/plugin-runtime";
import mod from "../src/agntux-slack-view.js";

// ── In-memory fs factory ─────────────────────────────────────────────────────

function inMemoryFs(files: Record<string, string>): ViewToolFs {
  return {
    async readFile(path: string) {
      const content = files[path];
      if (content == null) throw new ViewToolFsError("not-found", path);
      return Buffer.from(content, "utf8");
    },
    async readMany(paths: string[]) {
      return paths.map((p) => {
        const content = files[p];
        return content != null ? Buffer.from(content, "utf8") : null;
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

const FIXED_SCOPE: ViewToolScope = {
  user_id: "test-user",
  organization_id: "test-org",
};

function makeCtx(files: Record<string, string>, now?: Date): ViewToolContext {
  const fixedNow = now ?? new Date("2026-05-17T12:00:00Z");
  return {
    fs: inMemoryFs(files),
    scope: FIXED_SCOPE,
    now: () => fixedNow,
    log: () => undefined,
    withScope: () => makeCtx(files, fixedNow),
  };
}

// ── Action file builders ─────────────────────────────────────────────────────

function makeSlackComposeActionFile(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: medium
reason_class: slack_reply
reason_detail: Reply to #general thread
---

## Why this matters

The team is waiting for a decision on the Q3 roadmap.

## Compose payload

\`\`\`yaml
initial_verb: reply
channel:
  id: C001
  name: general
  is_dm: false
thread:
  parent_ts: "1234567890.000100"
  parent_author_real_name: Alice
  parent_excerpt: "What is the Q3 plan?"
  last_reply_ts: null
  last_reply_author_real_name: null
  last_reply_excerpt: null
  total_replies: 0
  participants:
    - Alice
messages_preview: []
messages_truncated: false
drafted_body: "Here is my reply about the Q3 plan."
personalization_signals: []
proposed_send_time: null
slack_permalink: null
\`\`\`
`;
}

function makeSlackCanvasActionFile(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: high
reason_class: slack_canvas
reason_detail: Summarise the design review thread
---

## Why this matters

The design review needs a canvas summary.

## Canvas payload

\`\`\`yaml
channel:
  id: C002
  name: design
thread:
  parent_ts: "1111111111.000200"
  participants:
    - Bob
    - Carol
  summary_excerpt: "Design review for the new dashboard."
drafted_canvas:
  title: "Design Review Summary"
  tldr: "The team reviewed the new dashboard design."
  decisions: []
  open_questions: []
  followup_message: null
proposed_followup_message: "I will follow up after the review."
\`\`\`
`;
}

// ── Exported ViewTool entries ─────────────────────────────────────────────────

// mod.viewTools = [composeView, canvasView] per agntux-slack-view.ts
const composeTool = mod.viewTools[0]!;
const canvasTool = mod.viewTools[1]!;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("agntux-slack compose_view payload shape", () => {
  // Keys the iframe renders per compose-ui.tsx + ComposePayloadOk interface.
  const KEPT_KEYS = new Set([
    "action_id",
    "initial_verb",
    "channel",
    "thread",
    "messages_preview",
    "messages_truncated",
    "drafted_body",
    "personalization_signals",
    "proposed_send_time",
    "slack_permalink",
  ]);

  // 4000-char budget mirrors MAX_DRAFTED_BODY_CHARS in agntux-slack-view.ts.
  const PAYLOAD_BUDGET_BYTES = 20 * 1024;

  it("returns action_not_found when action file is absent", async () => {
    const result = await composeTool.handle(
      { action_id: "missing-action" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns action_not_found for a blank or invalid action_id", async () => {
    const result = await composeTool.handle({ action_id: "" }, makeCtx({}));
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
  });

  it("returns compose_payload_missing when action file has no Compose payload section", async () => {
    const files = {
      "actions/no-payload.md": `---\nid: no-payload\nstatus: open\npriority: medium\nreason_class: slack_reply\n---\n\n## Why this matters\n\nNo payload here.\n`,
    };
    const result = await composeTool.handle(
      { action_id: "no-payload" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("compose_payload_missing");
  });

  it("returns action_already_handled for a done action", async () => {
    const files = {
      "actions/done-action.md": `---\nid: done-action\nstatus: done\npriority: medium\nreason_class: slack_reply\ncompleted_at: 2026-05-16T10:00:00Z\n---\n\n## Why this matters\n\nAlready done.\n\n## Compose payload\n\n\`\`\`yaml\ninitial_verb: reply\n\`\`\`\n`,
    };
    const result = await composeTool.handle(
      { action_id: "done-action" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_already_handled");
  });

  it("returns well-shaped ComposePayloadOk for a valid open action", async () => {
    const actionId = "slack-compose-001";
    const files = {
      [`actions/${actionId}.md`]: makeSlackComposeActionFile(actionId),
    };

    const result = await composeTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;

    expect("error" in sc).toBe(false);
    if ("error" in sc) return;

    // action_id echoed back
    expect((sc as Record<string, unknown>).action_id).toBe(actionId);

    // All expected keys present, no unexpected keys
    const keys = new Set(Object.keys(sc as object));
    for (const k of keys) {
      expect(KEPT_KEYS.has(k), `unexpected key "${k}" in compose payload`).toBe(true);
    }
    for (const k of KEPT_KEYS) {
      expect(keys.has(k), `missing required key "${k}" in compose payload`).toBe(true);
    }

    // Payload size guard
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("truncates drafted_body to MAX_DRAFTED_BODY_CHARS (4000 chars)", async () => {
    const actionId = "slack-long-draft";
    const longBody = "x".repeat(8000);
    const file = `---
id: ${actionId}
status: open
priority: medium
reason_class: slack_reply
reason_detail: Long draft test
---

## Why this matters

Long draft.

## Compose payload

\`\`\`yaml
initial_verb: reply
channel:
  id: C001
  name: general
  is_dm: false
thread:
  parent_ts: "1234567890.000100"
  parent_author_real_name: Alice
  parent_excerpt: "Question?"
  last_reply_ts: null
  last_reply_author_real_name: null
  last_reply_excerpt: null
  total_replies: 0
  participants: []
messages_preview: []
messages_truncated: false
drafted_body: "${longBody}"
personalization_signals: []
proposed_send_time: null
slack_permalink: null
\`\`\`
`;
    const files = { [`actions/${actionId}.md`]: file };
    const result = await composeTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect("error" in sc).toBe(false);
    const drafted = sc.drafted_body as string;
    expect(drafted.length).toBeLessThanOrEqual(4001); // 4000 chars + possible ellipsis char
  });
});

describe("agntux-slack canvas_view payload shape", () => {
  const CANVAS_KEPT_KEYS = new Set([
    "action_id",
    "channel",
    "thread",
    "drafted_canvas",
    "proposed_followup_message",
  ]);

  it("returns action_not_found when action file is absent", async () => {
    const result = await canvasTool.handle(
      { action_id: "missing-canvas" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns canvas_payload_missing when action file has no Canvas payload section", async () => {
    const files = {
      "actions/no-canvas.md": `---\nid: no-canvas\nstatus: open\npriority: medium\nreason_class: slack_canvas\n---\n\n## Why this matters\n\nNo canvas here.\n`,
    };
    const result = await canvasTool.handle(
      { action_id: "no-canvas" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("canvas_payload_missing");
  });

  it("returns well-shaped CanvasPayloadOk for a valid open action", async () => {
    const actionId = "slack-canvas-001";
    const files = {
      [`actions/${actionId}.md`]: makeSlackCanvasActionFile(actionId),
    };

    const result = await canvasTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;

    expect("error" in sc).toBe(false);
    if ("error" in sc) return;

    const keys = new Set(Object.keys(sc as object));
    for (const k of keys) {
      expect(CANVAS_KEPT_KEYS.has(k), `unexpected key "${k}" in canvas payload`).toBe(true);
    }
    for (const k of CANVAS_KEPT_KEYS) {
      expect(keys.has(k), `missing key "${k}" in canvas payload`).toBe(true);
    }
  });
});

// =============================================================================
// Response envelope guard — every handler return (success AND error) must
// ship a `content[]` block alongside `structuredContent` that explains the
// MCP Apps lifecycle to the model. Frozen anchor strings: `iframe`, `host`,
// `MCP App`. See the production bug (Claude Cowork post-render commentary /
// duplicate-widget) referenced in the plan at
// ~/.claude/plans/image-1-claude-cowork-playful-backus.md.
// =============================================================================

function assertEnvelope(content: unknown) {
  expect(Array.isArray(content)).toBe(true);
  if (!Array.isArray(content)) return;
  expect(content[0].type).toBe("text");
  const text = content[0].text as string;
  expect(text).toContain("iframe");
  expect(text).toContain("host");
  expect(text).toContain("MCP App");
}

describe("agntux-slack compose_view response envelope", () => {
  it("success path ships the canonical content[] explanation", async () => {
    const actionId = "envelope-compose-001";
    const files = {
      [`actions/${actionId}.md`]: makeSlackComposeActionFile(actionId),
    };
    const result = await composeTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("action_not_found error path ships the canonical content[] explanation", async () => {
    const result = await composeTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    assertEnvelope(result.content);
  });

  it("compose_payload_missing error path ships the canonical content[] explanation", async () => {
    const files = {
      "actions/no-payload.md": `---\nid: no-payload\nstatus: open\npriority: medium\nreason_class: slack_reply\n---\n\n## Why this matters\n\nNo payload.\n`,
    };
    const result = await composeTool.handle(
      { action_id: "no-payload" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("action_already_handled error path ships the canonical content[] explanation", async () => {
    // Without this branch covered, a refactor that adds a bare
    // `return { structuredContent: ... }` for the handled-action
    // branch alone would slip past the per-branch envelope guards.
    const files = {
      "actions/done-action.md": `---\nid: done-action\nstatus: done\npriority: medium\nreason_class: slack_reply\ncompleted_at: 2026-05-16T10:00:00Z\n---\n\n## Why this matters\n\nAlready done.\n\n## Compose payload\n\n\`\`\`yaml\ninitial_verb: reply\n\`\`\`\n`,
    };
    const result = await composeTool.handle(
      { action_id: "done-action" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });
});

describe("agntux-slack canvas_view response envelope", () => {
  it("success path ships the canonical content[] explanation", async () => {
    const actionId = "envelope-canvas-001";
    const files = {
      [`actions/${actionId}.md`]: makeSlackCanvasActionFile(actionId),
    };
    const result = await canvasTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("action_not_found error path ships the canonical content[] explanation", async () => {
    const result = await canvasTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    assertEnvelope(result.content);
  });

  it("action_already_handled error path ships the canonical content[] explanation", async () => {
    // Canvas handler had zero coverage of the already-handled branch
    // before this — the per-branch envelope guard is the test that
    // catches a future refactor that adds a bare-structuredContent
    // return for the dismissed/done canvas case.
    const files = {
      "actions/done-canvas.md": `---\nid: done-canvas\nstatus: done\npriority: high\nreason_class: slack_canvas\ncompleted_at: 2026-05-16T10:00:00Z\n---\n\n## Why this matters\n\nAlready done.\n\n## Canvas payload\n\n\`\`\`yaml\nchannel:\n  id: C002\n  name: design\n\`\`\`\n`,
    };
    const result = await canvasTool.handle(
      { action_id: "done-canvas" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_already_handled");
    assertEnvelope(result.content);
  });
});

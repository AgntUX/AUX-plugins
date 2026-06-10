// =============================================================================
// payload-shape.test.ts — payload-shape regression guard for agntux-jira.
//
// Exercises all 5 view tools via their compiled handlers (loaded from
// src/agntux-jira-view.ts via the .js import). All I/O goes through an
// in-memory fs shim; no real filesystem is touched.
//
// structuredContent key sets derived from the payload reference files:
//   - skills/agntux-jira/_overrides/reference/comment-payload.md     §structuredContent keys
//   - skills/agntux-jira/_overrides/reference/transition-payload.md  §structuredContent keys
//   - skills/agntux-jira/_overrides/reference/assign-payload.md      §structuredContent keys
//   - skills/agntux-jira/_overrides/reference/edit-payload.md        §structuredContent keys
//   - skills/agntux-jira/_overrides/reference/log-work-payload.md    §structuredContent keys
//
// KEPT_KEYS sets are the verbatim key names from those tables. No phantom keys.
// PAYLOAD_BUDGET_BYTES = 30 KB (single-row views; well below the 64 KB host cap).
//
// Pass 11 (E24/E25) of the marketplace linter requires a Buffer.byteLength +
// JSON.stringify + toBeLessThan assertion in this file.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
  ViewToolScope,
} from "@agntux/plugin-runtime";
import { ViewToolFsError } from "@agntux/plugin-runtime";
import mod from "../src/agntux-jira-view.js";

// ── Budget ────────────────────────────────────────────────────────────────────

// 30 KB per single-row view — comfortable well below the 64 KB host cap.
const PAYLOAD_BUDGET_BYTES = 30 * 1024;

// ── structuredContent key sets (derived verbatim from payload .md files) ─────

// From comment-payload.md §structuredContent keys:
const COMMENT_KEYS = new Set([
  "cloud_id",
  "issue_key",
  "issue_url",
  "issue_title",
  "issue_status",
  "issue_assignee",
  "issue_priority",
  "draft_body",
  "personalization_signals",
  "generated_at",
]);

// From transition-payload.md §structuredContent keys:
const TRANSITION_KEYS = new Set([
  "cloud_id",
  "issue_key",
  "issue_url",
  "issue_title",
  "current_state",
  "available_transitions",
  "suggested_transition_id",
  "optional_comment",
  "personalization_signals",
  "generated_at",
]);

// From assign-payload.md §structuredContent keys:
const ASSIGN_KEYS = new Set([
  "cloud_id",
  "issue_key",
  "issue_url",
  "issue_title",
  "current_assignee",
  "candidate_assignees",
  "suggested_assignee_account_id",
  "personalization_signals",
  "generated_at",
]);

// From edit-payload.md §structuredContent keys:
const EDIT_KEYS = new Set([
  "cloud_id",
  "issue_key",
  "issue_url",
  "current_summary",
  "current_priority",
  "current_labels",
  "available_priorities",
  "available_labels",
  "draft_summary",
  "draft_priority",
  "draft_labels",
  "personalization_signals",
  "generated_at",
]);

// From log-work-payload.md §structuredContent keys:
const LOG_WORK_KEYS = new Set([
  "cloud_id",
  "issue_key",
  "issue_url",
  "issue_title",
  "suggested_time_spent",
  "suggested_started",
  "draft_comment",
  "personalization_signals",
  "generated_at",
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

const FIXED_SCOPE: ViewToolScope = {
  user_id: "test-user",
  organization_id: "test-org",
};

function makeCtx(files: Record<string, string>, now?: Date): ViewToolContext {
  const fixedNow = now ?? new Date("2026-06-08T12:00:00Z");
  return {
    fs: inMemoryFs(files),
    scope: FIXED_SCOPE,
    now: () => fixedNow,
    log: () => undefined,
    withScope: () => makeCtx(files, fixedNow),
  };
}

// ── Action file builders ──────────────────────────────────────────────────────

function makeCommentActionFile(actionId: string, draftBody = "A comment draft."): string {
  return `---
id: ${actionId}
status: open
priority: medium
type: action-item
schema_version: "1.0.0"
source: jira
---

## Why this matters

Issue OFM-412 needs a reply.

## Comment payload

\`\`\`yaml
cloud_id: "1c5b1484-c964-4d92-bb3e-9237be54ca08"
issue_key: "OFM-412"
issue_url: "https://agntux.atlassian.net/browse/OFM-412"
issue_title: "Fix the login redirect"
issue_status: "In Review"
issue_assignee: "John Jordan"
issue_priority: "High"
draft_body: |
  ${draftBody}
personalization_signals:
  - "Reviewer asked a direct question"
generated_at: "2026-06-08T12:00:00Z"
\`\`\`
`;
}

function makeTransitionActionFile(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: medium
type: action-item
schema_version: "1.0.0"
source: jira
---

## Why this matters

OFM-412 has been In Progress for 4 business days.

## Transition payload

\`\`\`yaml
cloud_id: "1c5b1484-c964-4d92-bb3e-9237be54ca08"
issue_key: "OFM-412"
issue_url: "https://agntux.atlassian.net/browse/OFM-412"
issue_title: "Fix the login redirect"
current_state: "In Progress"
available_transitions:
  - id: "31"
    name: "In Review"
  - id: "41"
    name: "Done"
suggested_transition_id: "31"
optional_comment: null
personalization_signals:
  - "In Progress for 4 business days"
generated_at: "2026-06-08T12:00:00Z"
\`\`\`
`;
}

function makeAssignActionFile(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: medium
type: action-item
schema_version: "1.0.0"
source: jira
---

## Why this matters

OFM-415 is unassigned.

## Assign payload

\`\`\`yaml
cloud_id: "1c5b1484-c964-4d92-bb3e-9237be54ca08"
issue_key: "OFM-415"
issue_url: "https://agntux.atlassian.net/browse/OFM-415"
issue_title: "Set up CI pipeline"
current_assignee: null
candidate_assignees:
  - account_id: "5e7b3c1d2f4e1a0012345678"
    display_name: "Josue Reyes"
  - account_id: "6f8c4d2e3a5b1c0023456789"
    display_name: "Jonathan Vega"
suggested_assignee_account_id: "5e7b3c1d2f4e1a0012345678"
personalization_signals:
  - "Josue owns CI for OFM"
generated_at: "2026-06-08T12:00:00Z"
\`\`\`
`;
}

function makeEditActionFile(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: medium
type: action-item
schema_version: "1.0.0"
source: jira
---

## Why this matters

OFM-420 summary contains placeholder text.

## Edit payload

\`\`\`yaml
cloud_id: "1c5b1484-c964-4d92-bb3e-9237be54ca08"
issue_key: "OFM-420"
issue_url: "https://agntux.atlassian.net/browse/OFM-420"
current_summary: "[PLACEHOLDER] Fix the thing"
current_priority: "Medium"
current_labels: []
available_priorities:
  - Highest
  - High
  - Medium
  - Low
  - Lowest
available_labels:
  - infra
  - auth
  - frontend
draft_summary: "Fix the session token expiry on logout"
draft_priority: null
draft_labels: null
personalization_signals:
  - "Summary contained placeholder text [PLACEHOLDER]"
generated_at: "2026-06-08T12:00:00Z"
\`\`\`
`;
}

function makeLogWorkActionFile(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: medium
type: action-item
schema_version: "1.0.0"
source: jira
---

## Why this matters

OFM-412 has no worklog for John.

## Log-work payload

\`\`\`yaml
cloud_id: "1c5b1484-c964-4d92-bb3e-9237be54ca08"
issue_key: "OFM-412"
issue_url: "https://agntux.atlassian.net/browse/OFM-412"
issue_title: "Fix the login redirect"
suggested_time_spent: "1h 30m"
suggested_started: "2026-06-08T09:00:00Z"
draft_comment: null
personalization_signals:
  - "No worklog found for John in the last sprint"
generated_at: "2026-06-08T12:00:00Z"
\`\`\`
`;
}

// ── Exported ViewTool entries ─────────────────────────────────────────────────

// mod.viewTools order mirrors listing.yaml ui_components order:
//   [0] jira_comment_view
//   [1] jira_transition_view
//   [2] jira_assign_view
//   [3] jira_edit_view
//   [4] jira_logwork_view
const commentTool = mod.viewTools[0]!;
const transitionTool = mod.viewTools[1]!;
const assignTool = mod.viewTools[2]!;
const editTool = mod.viewTools[3]!;
const logWorkTool = mod.viewTools[4]!;

// ── Helper: key-set assertions ────────────────────────────────────────────────

function assertKeySet(
  sc: Record<string, unknown>,
  expected: Set<string>,
  label: string,
) {
  const keys = new Set(Object.keys(sc));
  for (const k of keys) {
    expect(expected.has(k), `unexpected key "${k}" in ${label} payload`).toBe(true);
  }
  for (const k of expected) {
    expect(keys.has(k), `missing required key "${k}" in ${label} payload`).toBe(true);
  }
}

function assertEnvelope(content: unknown) {
  expect(Array.isArray(content)).toBe(true);
  if (!Array.isArray(content)) return;
  expect(content[0].type).toBe("text");
  const text = content[0].text as string;
  expect(text).toContain("iframe");
  expect(text).toContain("host");
  expect(text).toContain("MCP App");
}

// =============================================================================
// COMMENT VIEW
// =============================================================================

describe("jira_comment_view payload shape", () => {
  it("returns action_not_found when action file is absent", async () => {
    const result = await commentTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns comment_payload_missing when action has no ## Comment payload section", async () => {
    const files = {
      "actions/no-payload.md": `---\nid: no-payload\nstatus: open\ntype: action-item\n---\n\n## Why this matters\n\nNo payload.\n`,
    };
    const result = await commentTool.handle(
      { action_id: "no-payload" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
  });

  it("returns well-shaped CommentPayloadOk for a valid open action", async () => {
    const actionId = "jira-comment-001";
    const files = { [`actions/${actionId}.md`]: makeCommentActionFile(actionId) };
    const result = await commentTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    assertKeySet(sc as Record<string, unknown>, COMMENT_KEYS, "comment");
    expect((sc as Record<string, unknown>).issue_key).toBe("OFM-412");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("draft_body truncation stays under budget for an 8000-char body", async () => {
    const actionId = "jira-comment-long";
    const longBody = "x".repeat(8000);
    const files = {
      [`actions/${actionId}.md`]: makeCommentActionFile(actionId, longBody),
    };
    const result = await commentTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("returns action_already_handled for a done action", async () => {
    const files = {
      "actions/done.md": `---\nid: done\nstatus: done\ntype: action-item\n---\n\n## Comment payload\n\n\`\`\`yaml\ncloud_id: "x"\n\`\`\`\n`,
    };
    const result = await commentTool.handle({ action_id: "done" }, makeCtx(files));
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_already_handled");
  });
});

// =============================================================================
// TRANSITION VIEW
// =============================================================================

describe("jira_transition_view payload shape", () => {
  it("returns action_not_found when action file is absent", async () => {
    const result = await transitionTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns well-shaped TransitionPayloadOk for a valid open action", async () => {
    const actionId = "jira-transition-001";
    const files = { [`actions/${actionId}.md`]: makeTransitionActionFile(actionId) };
    const result = await transitionTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    assertKeySet(sc as Record<string, unknown>, TRANSITION_KEYS, "transition");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("available_transitions is an array in the payload", async () => {
    const actionId = "jira-transition-002";
    const files = { [`actions/${actionId}.md`]: makeTransitionActionFile(actionId) };
    const result = await transitionTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    if ("error" in sc) return;
    const transitions = (sc as Record<string, unknown>).available_transitions;
    expect(Array.isArray(transitions)).toBe(true);
  });
});

// =============================================================================
// ASSIGN VIEW
// =============================================================================

describe("jira_assign_view payload shape", () => {
  it("returns action_not_found when action file is absent", async () => {
    const result = await assignTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns well-shaped AssignPayloadOk for a valid open action", async () => {
    const actionId = "jira-assign-001";
    const files = { [`actions/${actionId}.md`]: makeAssignActionFile(actionId) };
    const result = await assignTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    assertKeySet(sc as Record<string, unknown>, ASSIGN_KEYS, "assign");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("candidate_assignees is an array in the payload", async () => {
    const actionId = "jira-assign-002";
    const files = { [`actions/${actionId}.md`]: makeAssignActionFile(actionId) };
    const result = await assignTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    if ("error" in sc) return;
    const candidates = (sc as Record<string, unknown>).candidate_assignees;
    expect(Array.isArray(candidates)).toBe(true);
  });
});

// =============================================================================
// EDIT VIEW
// =============================================================================

describe("jira_edit_view payload shape", () => {
  it("returns action_not_found when action file is absent", async () => {
    const result = await editTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns well-shaped EditPayloadOk for a valid open action", async () => {
    const actionId = "jira-edit-001";
    const files = { [`actions/${actionId}.md`]: makeEditActionFile(actionId) };
    const result = await editTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    assertKeySet(sc as Record<string, unknown>, EDIT_KEYS, "edit");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("available_priorities is an array in the payload", async () => {
    const actionId = "jira-edit-002";
    const files = { [`actions/${actionId}.md`]: makeEditActionFile(actionId) };
    const result = await editTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    if ("error" in sc) return;
    const priorities = (sc as Record<string, unknown>).available_priorities;
    expect(Array.isArray(priorities)).toBe(true);
  });
});

// =============================================================================
// LOG-WORK VIEW
// =============================================================================

describe("jira_logwork_view payload shape", () => {
  it("returns action_not_found when action file is absent", async () => {
    const result = await logWorkTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns well-shaped LogWorkPayloadOk for a valid open action", async () => {
    const actionId = "jira-logwork-001";
    const files = { [`actions/${actionId}.md`]: makeLogWorkActionFile(actionId) };
    const result = await logWorkTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    assertKeySet(sc as Record<string, unknown>, LOG_WORK_KEYS, "log-work");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("suggested_time_spent is a non-empty string in the payload", async () => {
    const actionId = "jira-logwork-002";
    const files = { [`actions/${actionId}.md`]: makeLogWorkActionFile(actionId) };
    const result = await logWorkTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    if ("error" in sc) return;
    const timeSpent = (sc as Record<string, unknown>).suggested_time_spent;
    expect(typeof timeSpent).toBe("string");
    expect((timeSpent as string).length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Render-harness contract — all 5 handlers must survive {} args (cold render)
// =============================================================================

describe("render-harness contract — all handlers survive empty args {}", () => {
  const TOOLS = [
    { name: "jira_comment_view", tool: commentTool, keys: COMMENT_KEYS },
    { name: "jira_transition_view", tool: transitionTool, keys: TRANSITION_KEYS },
    { name: "jira_assign_view", tool: assignTool, keys: ASSIGN_KEYS },
    { name: "jira_edit_view", tool: editTool, keys: EDIT_KEYS },
    { name: "jira_logwork_view", tool: logWorkTool, keys: LOG_WORK_KEYS },
  ];

  for (const { name, tool } of TOOLS) {
    it(`${name}: renders a placeholder for empty args {} without throwing`, async () => {
      const result = await tool.handle(
        {} as { action_id: string },
        makeCtx({}),
      );
      const sc = result.structuredContent as Record<string, unknown>;
      const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
      expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
      expect(Array.isArray(result.content)).toBe(true);
    });

    it(`${name}: degrades to a placeholder when ctx.fs throws a non-ViewToolFsError`, async () => {
      const ctx = makeCtx({});
      ctx.fs.readFile = async () => {
        throw new Error("boom: backend unavailable");
      };
      const result = await tool.handle({ action_id: "anything" }, ctx);
      const sc = result.structuredContent as Record<string, unknown>;
      const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
      expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
      expect(Array.isArray(result.content)).toBe(true);
    });
  }
});

// =============================================================================
// Response envelope guard — all handlers must ship content[] with iframe/host/MCP App
// =============================================================================

describe("response envelope guard — all handlers ship canonical content[] explanation", () => {
  it("jira_comment_view success path", async () => {
    const actionId = "env-comment-001";
    const files = { [`actions/${actionId}.md`]: makeCommentActionFile(actionId) };
    const result = await commentTool.handle({ action_id: actionId }, makeCtx(files));
    assertEnvelope(result.content);
  });

  it("jira_comment_view missing-file error path", async () => {
    const result = await commentTool.handle({ action_id: "missing" }, makeCtx({}));
    assertEnvelope(result.content);
  });

  it("jira_transition_view success path", async () => {
    const actionId = "env-transition-001";
    const files = { [`actions/${actionId}.md`]: makeTransitionActionFile(actionId) };
    const result = await transitionTool.handle({ action_id: actionId }, makeCtx(files));
    assertEnvelope(result.content);
  });

  it("jira_assign_view success path", async () => {
    const actionId = "env-assign-001";
    const files = { [`actions/${actionId}.md`]: makeAssignActionFile(actionId) };
    const result = await assignTool.handle({ action_id: actionId }, makeCtx(files));
    assertEnvelope(result.content);
  });

  it("jira_edit_view success path", async () => {
    const actionId = "env-edit-001";
    const files = { [`actions/${actionId}.md`]: makeEditActionFile(actionId) };
    const result = await editTool.handle({ action_id: actionId }, makeCtx(files));
    assertEnvelope(result.content);
  });

  it("jira_logwork_view success path", async () => {
    const actionId = "env-logwork-001";
    const files = { [`actions/${actionId}.md`]: makeLogWorkActionFile(actionId) };
    const result = await logWorkTool.handle({ action_id: actionId }, makeCtx(files));
    assertEnvelope(result.content);
  });

  it("jira_comment_view action_already_handled error path", async () => {
    const files = {
      "actions/done.md": `---\nid: done\nstatus: done\ntype: action-item\n---\n\n## Comment payload\n\n\`\`\`yaml\ncloud_id: "x"\n\`\`\`\n`,
    };
    const result = await commentTool.handle({ action_id: "done" }, makeCtx(files));
    assertEnvelope(result.content);
  });
});

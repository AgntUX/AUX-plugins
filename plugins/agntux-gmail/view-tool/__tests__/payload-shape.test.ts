// =============================================================================
// payload-shape.test.ts — regression guard for agntux-gmail view-tool.
//
// Mirrors the agntux-core pattern in plugins/agntux-core/view-tool/__tests__/
// payload-shape.test.ts. Exercises handleCompose via the exported ViewTool;
// all I/O goes through an in-memory fs shim.
//
// Does NOT test compose-ui.tsx directly — that is a React+DOM module
// requiring a real browser environment. SimpleMcpApp protocol integration
// is covered by its own unit tests.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
  ViewToolScope,
} from "@agntux/plugin-runtime";
import { ViewToolFsError } from "@agntux/plugin-runtime";
import mod from "../src/agntux-gmail-view.js";

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

// ── Action file builder ──────────────────────────────────────────────────────

function makeGmailComposeActionFile(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: medium
reason_class: gmail_reply
reason_detail: Reply to quarterly sync email
---

## Why this matters

Alice is waiting for a response about the quarterly sync.

## Compose payload

\`\`\`yaml
thread:
  thread_id: thread-001
  subject: "Q3 Quarterly Sync"
  parent_message_id: msg-001
  parent_author_real_name: Alice
  parent_author_email: alice@example.com
  parent_excerpt: "Can we sync on Q3 goals?"
  last_message_id: msg-001
  last_author_real_name: Alice
  last_author_email: alice@example.com
  last_excerpt: "Can we sync on Q3 goals?"
  total_messages: 1
  participants:
    - real_name: Alice
      email: alice@example.com
recipients:
  to:
    - alice@example.com
  cc: []
  bcc: []
reply_to_message_id: msg-001
drafted_body: "Hi Alice, happy to sync on Q3 goals."
personalization_signals: []
email_context: "This is an internal planning thread."
gmail_thread_url: null
user_email: null
account_index: null
\`\`\`
`;
}

// ── Exported ViewTool entry ──────────────────────────────────────────────────

const composeTool = mod.viewTools[0]!;

// Keys the iframe renders per compose-ui.tsx + ComposePayloadOk interface.
const KEPT_KEYS = new Set([
  "action_id",
  "thread",
  "recipients",
  "reply_to_message_id",
  "drafted_body",
  "personalization_signals",
  "email_context",
  "gmail_thread_url",
  "user_email",
  "account_index",
]);

// 4000-char drafted_body cap + overhead; keep total under 20 KB.
const PAYLOAD_BUDGET_BYTES = 20 * 1024;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("agntux-gmail compose_view payload shape", () => {
  it("returns action_not_found when action file is absent", async () => {
    const result = await composeTool.handle(
      { action_id: "missing-action" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns action_not_found for a blank action_id", async () => {
    const result = await composeTool.handle({ action_id: "" }, makeCtx({}));
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
  });

  it("returns compose_payload_missing when action file has no Compose payload section", async () => {
    const files = {
      "actions/no-payload.md": `---\nid: no-payload\nstatus: open\npriority: medium\nreason_class: gmail_reply\n---\n\n## Why this matters\n\nNo payload here.\n`,
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
      "actions/done-action.md": `---\nid: done-action\nstatus: done\npriority: medium\nreason_class: gmail_reply\ncompleted_at: 2026-05-16T10:00:00Z\n---\n\n## Why this matters\n\nAlready handled.\n\n## Compose payload\n\n\`\`\`yaml\nthread_id: thread-001\n\`\`\`\n`,
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
    const actionId = "gmail-compose-001";
    const files = {
      [`actions/${actionId}.md`]: makeGmailComposeActionFile(actionId),
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

    // Field-shape guard: every row must have EXACTLY the kept keys.
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
    const actionId = "gmail-long-draft";
    const longBody = "y".repeat(8000);
    const file = `---
id: ${actionId}
status: open
priority: medium
reason_class: gmail_reply
reason_detail: Long draft test
---

## Why this matters

Long draft.

## Compose payload

\`\`\`yaml
thread:
  thread_id: thread-002
  subject: "Long draft"
  parent_message_id: msg-002
  parent_author_real_name: Bob
  parent_author_email: bob@example.com
  parent_excerpt: "Hello?"
  last_message_id: msg-002
  last_author_real_name: Bob
  last_author_email: bob@example.com
  last_excerpt: "Hello?"
  total_messages: 1
  participants: []
recipients:
  to: []
  cc: []
  bcc: []
reply_to_message_id: msg-002
drafted_body: "${longBody}"
personalization_signals: []
email_context: ""
gmail_thread_url: null
user_email: null
account_index: null
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
    expect(drafted.length).toBeLessThanOrEqual(4001);
  });

  it("payload is under budget bytes for a maximally-loaded response", async () => {
    const actionId = "gmail-max-load";
    const files = {
      [`actions/${actionId}.md`]: makeGmailComposeActionFile(actionId),
    };
    const result = await composeTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
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

describe("agntux-gmail compose_view response envelope", () => {
  function assertEnvelope(content: unknown) {
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0].type).toBe("text");
    const text = content[0].text as string;
    expect(text).toContain("iframe");
    expect(text).toContain("host");
    expect(text).toContain("MCP App");
  }

  it("success path ships the canonical content[] explanation", async () => {
    const actionId = "envelope-gmail-001";
    const files = {
      [`actions/${actionId}.md`]: makeGmailComposeActionFile(actionId),
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
      "actions/no-payload.md": `---\nid: no-payload\nstatus: open\npriority: medium\nreason_class: gmail_reply\n---\n\n## Why this matters\n\nNo payload here.\n`,
    };
    const result = await composeTool.handle(
      { action_id: "no-payload" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("action_already_handled error path ships the canonical content[] explanation", async () => {
    // The already-handled branch was shape-tested but not envelope-
    // tested before this — a future refactor that added a bare
    // `return { structuredContent: ... }` for the done/dismissed
    // branch alone would slip past the per-branch guards.
    const files = {
      "actions/done-action.md": `---\nid: done-action\nstatus: done\npriority: medium\nreason_class: gmail_reply\ncompleted_at: 2026-05-16T10:00:00Z\n---\n\n## Why this matters\n\nAlready handled.\n\n## Compose payload\n\n\`\`\`yaml\nthread_id: thread-001\n\`\`\`\n`,
    };
    const result = await composeTool.handle(
      { action_id: "done-action" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("malformed-body fallback path still ships the canonical content[] explanation", async () => {
    // The action file parses (`parseActionFile` is tolerant of
    // unrecognised body sections) but has no parseable `## Compose
    // payload` — so the handler lands on the `compose_payload_missing`
    // branch. This is a realistic failure mode under partial-write /
    // sync-race conditions where the file has frontmatter but the body
    // hasn't been finalised. The point isn't pinning the error code;
    // it's catching a future refactor that splits the bare-payload-
    // missing branch off into a separate return without the envelope.
    const files = {
      "actions/partial.md":
        "---\nid: partial\nstatus: open\npriority: medium\nreason_class: gmail_reply\n---\n\n## Why this matters\n\nFile exists but body is still being written by the sync daemon.\n",
    };
    const result = await composeTool.handle(
      { action_id: "partial" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    assertEnvelope(result.content);
  });
});

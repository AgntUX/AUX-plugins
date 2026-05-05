/**
 * compose-view.test.ts
 *
 * Unit tests for the `compose_view` render tool. Tests against real on-disk
 * action-item fixture files rooted at a temp `agntux/` directory. The handler
 * reads from the resolved AgntUX project root, injected via
 * `AGNTUX_ROOT_OVERRIDE` (vitest workers can't `process.chdir`).
 *
 * Coverage:
 *   - action_not_found when action_id is missing / malformed
 *   - action_not_found when action file does not exist on disk
 *   - action_already_handled for done / dismissed / future-snoozed actions
 *   - happy path: all caps applied (body, signals, participants, messages)
 *   - _meta.ui.resourceUri = ui://slack-compose + visibility array
 *   - initial_verb coercion: unknown falls back to "draft"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleComposeView } from "../src/tools/compose-view.js";

let tempBase: string;
let agntuxRoot: string;
let actionsDir: string;
const ORIGINAL_OVERRIDE = process.env.AGNTUX_ROOT_OVERRIDE;

function writeAction(name: string, frontmatter: string, body = ""): void {
  writeFileSync(join(actionsDir, `${name}.md`), `---\n${frontmatter}\n---\n\n${body}`);
}

function baseArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_id: "test-action-1",
    initial_verb: "draft",
    drafted_body: "Hello, this is my draft reply.",
    thread_context: {
      parent_ts: "1234567890.000100",
      parent_author_real_name: "Alice Smith",
      parent_excerpt: "Can you confirm the delivery timeline?",
      last_reply_ts: "1234567891.000100",
      last_reply_author_real_name: "Bob Jones",
      last_reply_excerpt: "Still waiting on confirmation.",
      total_replies: 3,
      participants: ["Alice Smith", "Bob Jones"],
      messages_preview: [
        { ts: "1234567890.000100", author: "Alice Smith", body_excerpt: "Can you confirm the delivery timeline?" },
        { ts: "1234567891.000100", author: "Bob Jones", body_excerpt: "Still waiting." },
      ],
    },
    channel: { id: "C123", name: "partner-platforms", is_dm: false },
    ...overrides,
  };
}

beforeEach(() => {
  tempBase = join(
    tmpdir(),
    `agntux-compose-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  );
  agntuxRoot = join(tempBase, "agntux");
  actionsDir = join(agntuxRoot, "actions");
  mkdirSync(actionsDir, { recursive: true });
  process.env.AGNTUX_ROOT_OVERRIDE = agntuxRoot;
});

afterEach(() => {
  if (ORIGINAL_OVERRIDE === undefined) {
    delete process.env.AGNTUX_ROOT_OVERRIDE;
  } else {
    process.env.AGNTUX_ROOT_OVERRIDE = ORIGINAL_OVERRIDE;
  }
  try { rmSync(tempBase, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Graceful degraded states ──────────────────────────────────────────────────

describe("handleComposeView — graceful degraded states", () => {
  it("returns action_not_found for a missing action file", async () => {
    const result = await handleComposeView(baseArgs());
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_not_found");
  });

  it("returns action_not_found for an empty action_id", async () => {
    const result = await handleComposeView(baseArgs({ action_id: "" }));
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_not_found");
  });

  it("returns action_not_found for an action_id with path traversal characters", async () => {
    const result = await handleComposeView(baseArgs({ action_id: "../etc/passwd" }));
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_not_found");
  });

  it("returns action_already_handled for a done action", async () => {
    writeAction("test-action-1", "id: test-action-1\nstatus: done\npriority: low\ncompleted_at: 2026-05-01T12:00:00Z");
    const result = await handleComposeView(baseArgs());
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_already_handled");
  });

  it("returns action_already_handled for a dismissed action", async () => {
    writeAction("test-action-1", "id: test-action-1\nstatus: dismissed\npriority: low\ndismissed_at: 2026-05-01T12:00:00Z");
    const result = await handleComposeView(baseArgs());
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_already_handled");
  });

  it("returns action_already_handled for a future-snoozed action", async () => {
    const futureDate = new Date(Date.now() + 86_400_000 * 2).toISOString();
    writeAction("test-action-1", `id: test-action-1\nstatus: snoozed\npriority: low\nsnoozed_until: ${futureDate}`);
    const result = await handleComposeView(baseArgs());
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_already_handled");
  });

  it("does NOT return action_already_handled for a past-snoozed action (snooze has expired)", async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    writeAction("test-action-1", `id: test-action-1\nstatus: snoozed\npriority: high\nsnoozed_until: ${pastDate}`);
    const result = await handleComposeView(baseArgs());
    // Past snooze = effectively open; no error
    expect((result.structuredContent as Record<string, unknown>).error).toBeUndefined();
  });
});

// ── Happy path + caps ─────────────────────────────────────────────────────────

describe("handleComposeView — happy path", () => {
  beforeEach(() => {
    writeAction("test-action-1", "id: test-action-1\nstatus: open\npriority: high\nsource: slack");
  });

  it("returns _meta.ui.resourceUri = ui://slack-compose", async () => {
    const result = await handleComposeView(baseArgs());
    expect(result._meta.ui.resourceUri).toBe("ui://slack-compose");
    expect(result._meta.ui.visibility).toEqual(["model", "app"]);
  });

  it("echoes action_id and initial_verb in structuredContent", async () => {
    const result = await handleComposeView(baseArgs({ initial_verb: "schedule" }));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("test-action-1");
    expect(sc.initial_verb).toBe("schedule");
  });

  it("truncates drafted_body to 4000 chars", async () => {
    const longBody = "x".repeat(5000);
    const result = await handleComposeView(baseArgs({ drafted_body: longBody }));
    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.drafted_body as string).length).toBeLessThanOrEqual(4000);
  });

  it("caps personalization_signals at 4 and truncates each to 120 chars", async () => {
    const signals = Array.from({ length: 8 }, (_, i) => `Signal ${i}: ${"x".repeat(200)}`);
    const result = await handleComposeView(baseArgs({ personalization_signals: signals }));
    const sc = result.structuredContent as Record<string, unknown>;
    const capped = sc.personalization_signals as string[];
    expect(capped.length).toBe(4);
    for (const s of capped) {
      expect(s.length).toBeLessThanOrEqual(120);
    }
  });

  it("caps messages_preview at 8 items", async () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      ts: `${i}`,
      author: `Author ${i}`,
      body_excerpt: "x".repeat(50),
    }));
    const result = await handleComposeView(
      baseArgs({
        thread_context: {
          ...(baseArgs().thread_context as Record<string, unknown>),
          messages_preview: messages,
        },
      }),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.messages_preview as unknown[]).length).toBe(8);
  });

  it("caps participants in thread at 6", async () => {
    const result = await handleComposeView(
      baseArgs({
        thread_context: {
          ...(baseArgs().thread_context as Record<string, unknown>),
          participants: ["A", "B", "C", "D", "E", "F", "G", "H"],
        },
      }),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const thread = sc.thread as Record<string, unknown>;
    expect((thread.participants as string[]).length).toBe(6);
  });

  it("coerces unknown initial_verb to 'draft'", async () => {
    const result = await handleComposeView(baseArgs({ initial_verb: "fax_it" }));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.initial_verb).toBe("draft");
  });

  it("propagates slack_permalink and proposed_send_time", async () => {
    const result = await handleComposeView(
      baseArgs({
        slack_permalink: "https://myteam.slack.com/archives/C123/p1234567890000100",
        proposed_send_time: "2026-05-05T09:00:00Z",
        initial_verb: "schedule",
      }),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.slack_permalink).toBe("https://myteam.slack.com/archives/C123/p1234567890000100");
    expect(sc.proposed_send_time).toBe("2026-05-05T09:00:00Z");
  });
});

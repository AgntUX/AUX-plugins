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
 *   - _meta.ui.resourceUri = ui://slack-compose on the result envelope
 *   - tool descriptor exposes both _meta.ui.resourceUri (modern) and
 *     _meta["ui/resourceUri"] (legacy) for cross-host compatibility
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

// ── Dual-mode resolution: action_id-only invocation lifts from `## Compose payload` ──

describe("handleComposeView — dual-mode (3.0.0+ on-disk payload fallback)", () => {
  function writeActionWithComposePayload(name: string): void {
    const frontmatter = "id: " + name + "\nstatus: open\npriority: high\nsource: slack";
    const body = [
      "## Why this matters",
      "Test action with pre-composed payload.",
      "",
      "## Compose payload",
      "",
      "```yaml",
      "drafted_body: |",
      "  Pre-composed reply from disk.",
      "  Multi-paragraph body.",
      "personalization_signals:",
      "  - \"Tone: terse — per user.md\"",
      "  - \"Direct stakeholder\"",
      "thread_context:",
      "  parent_ts: \"1714300000.000100\"",
      "  parent_author_real_name: John Smith",
      "  parent_excerpt: \"Original parent message.\"",
      "  last_reply_ts: \"1714386500.000300\"",
      "  last_reply_author_real_name: Sarah Lee",
      "  last_reply_excerpt: \"Latest reply text.\"",
      "  total_replies: 2",
      "  participants:",
      "    - John Smith",
      "    - Sarah Lee",
      "  messages_preview:",
      "    - ts: \"1714300000.000100\"",
      "      author: John Smith",
      "      body_excerpt: \"Original parent message.\"",
      "channel:",
      "  id: C01ABC",
      "  name: proj-mango",
      "  is_dm: false",
      "slack_permalink: \"https://oatfi.slack.com/archives/C01ABC/p1714300000000100\"",
      "generated_at: \"2026-04-28T09:00:00Z\"",
      "```",
    ].join("\n");
    writeFileSync(
      join(actionsDir, `${name}.md`),
      `---\n${frontmatter}\n---\n\n${body}\n`,
    );
  }

  it("invocation with only {action_id} lifts drafted_body, channel, thread_context from disk", async () => {
    writeActionWithComposePayload("test-action-1");
    const result = await handleComposeView({ action_id: "test-action-1" });
    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.drafted_body as string)).toContain("Pre-composed reply from disk.");
    const channel = sc.channel as Record<string, unknown>;
    expect(channel.id).toBe("C01ABC");
    expect(channel.name).toBe("proj-mango");
    const thread = sc.thread as Record<string, unknown>;
    expect(thread.parent_ts).toBe("1714300000.000100");
    expect(thread.total_replies).toBe(2);
    expect((sc.personalization_signals as string[]).length).toBe(2);
    // initial_verb defaults to "draft" when omitted
    expect(sc.initial_verb).toBe("draft");
    // No error envelope returned
    expect(sc.error).toBeUndefined();
  });

  it("invocation with {action_id, initial_verb: 'schedule'} preserves the requested mode", async () => {
    writeActionWithComposePayload("test-action-1");
    const result = await handleComposeView({
      action_id: "test-action-1",
      initial_verb: "schedule",
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.initial_verb).toBe("schedule");
    expect(sc.error).toBeUndefined();
  });

  it("inline drafted_body overrides the on-disk payload when both are present", async () => {
    writeActionWithComposePayload("test-action-1");
    const result = await handleComposeView({
      action_id: "test-action-1",
      initial_verb: "draft",
      drafted_body: "Inline override body — fresh working memory.",
      thread_context: {
        parent_ts: "9999999999.000100",
        parent_author_real_name: "Inline Author",
        parent_excerpt: "Inline excerpt",
        total_replies: 99,
        participants: ["Inline Person"],
        messages_preview: [],
      },
      channel: { id: "C-INLINE", name: "inline-channel", is_dm: true },
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.drafted_body).toBe("Inline override body — fresh working memory.");
    const channel = sc.channel as Record<string, unknown>;
    expect(channel.id).toBe("C-INLINE");
    expect(channel.is_dm).toBe(true);
    const thread = sc.thread as Record<string, unknown>;
    expect(thread.total_replies).toBe(99);
  });

  it("returns compose_payload_missing when neither inline drafted_body nor on-disk payload exist", async () => {
    // Action file without a `## Compose payload` body section
    writeAction(
      "test-action-1",
      "id: test-action-1\nstatus: open\npriority: high\nsource: slack",
      "## Why this matters\nThis action predates pre-composed drafts.",
    );
    const result = await handleComposeView({ action_id: "test-action-1" });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe("compose_payload_missing");
  });

  it("returns compose_payload_missing when the Compose payload section is missing the fenced YAML block", async () => {
    // The parser only recognises a fenced ```yaml block; prose-only sections
    // produce no payload and surface the missing-payload error.
    const frontmatter = "id: test-action-1\nstatus: open\npriority: high\nsource: slack";
    const body = [
      "## Compose payload",
      "",
      "(payload not yet generated — the next sync run will fill this in.)",
    ].join("\n");
    writeFileSync(
      join(actionsDir, "test-action-1.md"),
      `---\n${frontmatter}\n---\n\n${body}\n`,
    );
    const result = await handleComposeView({ action_id: "test-action-1" });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe("compose_payload_missing");
  });

  it("returns compose_payload_missing when the YAML parses but lacks drafted_body", async () => {
    // normalizeComposePayload returns null when drafted_body is empty —
    // an empty draft is useless, so we treat it as missing.
    const frontmatter = "id: test-action-1\nstatus: open\npriority: high\nsource: slack";
    const body = [
      "## Compose payload",
      "",
      "```yaml",
      "personalization_signals:",
      "  - \"Some signal\"",
      "channel:",
      "  id: C-X",
      "  name: x",
      "  is_dm: false",
      "```",
    ].join("\n");
    writeFileSync(
      join(actionsDir, "test-action-1.md"),
      `---\n${frontmatter}\n---\n\n${body}\n`,
    );
    const result = await handleComposeView({ action_id: "test-action-1" });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe("compose_payload_missing");
  });

  it("falls back to on-disk slack_permalink when inline arg omits it", async () => {
    writeActionWithComposePayload("test-action-1");
    const result = await handleComposeView({
      action_id: "test-action-1",
      initial_verb: "draft",
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.slack_permalink).toBe(
      "https://oatfi.slack.com/archives/C01ABC/p1714300000000100",
    );
  });
});

// ── Tool descriptor contract ─────────────────────────────────────────────────
//
// 5.1.1 regression guards. The host LLM reads `composeViewTool.description`
// and the per-parameter descriptions to decide which args to pass. Two
// trigger phrases must map verbatim:
//   'open the reply composer for action {id}'                  → {action_id}
//   'open the reply composer in schedule mode for action {id}' → {action_id, initial_verb: "schedule"}
// And every legacy inline arg must carry a "Do NOT pass for click-time
// trigger phrases" guard so the LLM doesn't synthesize partial inline args
// (empty channel: {}, empty thread_context: {}) that destructively override
// the on-disk `## Compose payload` lookup. Tests below pin the load-bearing
// pieces so a future copy-edit can't silently regress the bug fix.

describe("composeViewTool — descriptor contract", () => {
  it("description maps the draft trigger phrase to {action_id}", async () => {
    const { composeViewTool } = await import("../src/tools/compose-view.js");
    expect(composeViewTool.description).toContain(
      "'open the reply composer for action {id}' → call with {action_id: id}",
    );
  });

  it("description maps the schedule trigger phrase to {action_id, initial_verb: 'schedule'}", async () => {
    const { composeViewTool } = await import("../src/tools/compose-view.js");
    expect(composeViewTool.description).toContain(
      "'open the reply composer in schedule mode for action {id}' → call with {action_id: id, initial_verb: \"schedule\"}",
    );
  });

  it("initial_verb description spells out the 'in schedule mode' → 'schedule' mapping", async () => {
    const { composeViewTool } = await import("../src/tools/compose-view.js");
    const initialVerb = composeViewTool.inputSchema.properties.initial_verb;
    expect(initialVerb.description).toContain("'in schedule mode'");
    expect(initialVerb.description).toContain("'schedule'");
  });

  it("every legacy inline-arg parameter is labelled 'LEGACY back-compat only'", async () => {
    const { composeViewTool } = await import("../src/tools/compose-view.js");
    const legacy = [
      "drafted_body",
      "personalization_signals",
      "thread_context",
      "channel",
      "proposed_send_time",
      "slack_permalink",
    ] as const;
    const props = composeViewTool.inputSchema.properties as Record<
      string,
      { description: string }
    >;
    for (const name of legacy) {
      expect(props[name]?.description ?? "").toMatch(
        /LEGACY back-compat only.*Do NOT pass for click-time trigger phrases/s,
      );
    }
  });

  // Regression guard for the Cowork-text-render bug: the host expected the
  // deprecated flat key and silently fell back to text when it was missing.
  // The fix is to emit both keys, matching what the upstream registerAppTool
  // helper in @modelcontextprotocol/ext-apps does.
  it("descriptor _meta carries both modern and legacy resourceUri keys", async () => {
    const { composeViewTool } = await import("../src/tools/compose-view.js");
    const meta = composeViewTool._meta as {
      ui: { resourceUri: string };
      "ui/resourceUri": string;
    };
    expect(meta.ui.resourceUri).toBe("ui://slack-compose");
    expect(meta["ui/resourceUri"]).toBe("ui://slack-compose");
  });

  // Regression guard for the Cowork iframe-not-opening bug. Without
  // outputSchema, hosts can't tell structuredContent is iframe payload
  // and fall back to text-rendering it. Mirrors the official ext-apps
  // scenario-modeler-server example.
  it("descriptor declares outputSchema covering success + error shapes", async () => {
    const { composeViewTool } = await import("../src/tools/compose-view.js");
    const schema = composeViewTool.outputSchema as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    for (const key of [
      "action_id",
      "initial_verb",
      "channel",
      "thread",
      "drafted_body",
      "error",
    ]) {
      expect(schema.properties[key]).toBeDefined();
    }
    expect(schema.required ?? []).toEqual([]);
  });
});

/**
 * canvas-view.test.ts
 *
 * Unit tests for the `canvas_view` render tool.
 *
 * Coverage:
 *   - action_not_found for missing file / bad id / path traversal
 *   - action_already_handled for done / dismissed / future-snoozed
 *   - happy path: caps on title, tldr, decisions, open_questions, participants
 *   - _meta.ui.resourceUri = ui://slack-canvas
 *   - proposed_followup_message capped at 200 chars
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCanvasView } from "../src/tools/canvas-view.js";

let tempBase: string;
let agntuxRoot: string;
let actionsDir: string;
const ORIGINAL_OVERRIDE = process.env.AGNTUX_ROOT_OVERRIDE;

function writeAction(name: string, frontmatter: string, body = ""): void {
  writeFileSync(join(actionsDir, `${name}.md`), `---\n${frontmatter}\n---\n\n${body}`);
}

function baseArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_id: "canvas-action-1",
    drafted_canvas: {
      title: "Thread summary: Apex Phase 2 delivery",
      tldr: "The team agreed on a May 15 delivery target with a scope freeze by May 10.",
      decisions: ["Scope freeze May 10", "Delivery May 15"],
      open_questions: ["Who owns QA sign-off?"],
      participants: ["Alice", "Bob", "Carol"],
    },
    channel: { id: "C456", name: "eng-leads" },
    thread: { parent_ts: "1234567890.000100", total_replies: 5, participants: ["Alice", "Bob"] },
    proposed_followup_message: "Posted a thread summary.",
    ...overrides,
  };
}

beforeEach(() => {
  tempBase = join(
    tmpdir(),
    `agntux-canvas-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
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

describe("handleCanvasView — graceful degraded states", () => {
  it("returns action_not_found for a missing action file", async () => {
    const result = await handleCanvasView(baseArgs());
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_not_found");
  });

  it("returns action_not_found for empty action_id", async () => {
    const result = await handleCanvasView(baseArgs({ action_id: "" }));
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_not_found");
  });

  it("returns action_not_found for path traversal in action_id", async () => {
    const result = await handleCanvasView(baseArgs({ action_id: "../../etc/passwd" }));
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_not_found");
  });

  it("returns action_already_handled for a done action", async () => {
    writeAction("canvas-action-1", "id: canvas-action-1\nstatus: done\npriority: low\ncompleted_at: 2026-05-01T12:00:00Z");
    const result = await handleCanvasView(baseArgs());
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_already_handled");
  });

  it("returns action_already_handled for a dismissed action", async () => {
    writeAction("canvas-action-1", "id: canvas-action-1\nstatus: dismissed\npriority: low\ndismissed_at: 2026-05-01T12:00:00Z");
    const result = await handleCanvasView(baseArgs());
    expect((result.structuredContent as Record<string, unknown>).error).toBe("action_already_handled");
  });
});

// ── Happy path + caps ─────────────────────────────────────────────────────────

describe("handleCanvasView — happy path", () => {
  beforeEach(() => {
    writeAction("canvas-action-1", "id: canvas-action-1\nstatus: open\npriority: medium");
  });

  it("returns _meta.ui.resourceUri = ui://slack-canvas", async () => {
    const result = await handleCanvasView(baseArgs());
    expect(result._meta.ui.resourceUri).toBe("ui://slack-canvas");
  });

  it("echoes action_id and channel in structuredContent", async () => {
    const result = await handleCanvasView(baseArgs());
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("canvas-action-1");
    const ch = sc.channel as Record<string, unknown>;
    expect(ch.name).toBe("eng-leads");
  });

  it("truncates title to 80 chars", async () => {
    const result = await handleCanvasView(
      baseArgs({ drafted_canvas: { ...(baseArgs().drafted_canvas as object), title: "T".repeat(200) } }),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const dc = sc.drafted_canvas as Record<string, unknown>;
    expect((dc.title as string).length).toBeLessThanOrEqual(80);
  });

  it("truncates tldr to 500 chars", async () => {
    const result = await handleCanvasView(
      baseArgs({ drafted_canvas: { ...(baseArgs().drafted_canvas as object), tldr: "x".repeat(1000) } }),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const dc = sc.drafted_canvas as Record<string, unknown>;
    expect((dc.tldr as string).length).toBeLessThanOrEqual(500);
  });

  it("caps decisions at 8 items", async () => {
    const decisions = Array.from({ length: 12 }, (_, i) => `Decision ${i}`);
    const result = await handleCanvasView(
      baseArgs({ drafted_canvas: { ...(baseArgs().drafted_canvas as object), decisions } }),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const dc = sc.drafted_canvas as Record<string, unknown>;
    expect((dc.decisions as string[]).length).toBe(8);
  });

  it("caps open_questions at 8 items", async () => {
    const open_questions = Array.from({ length: 15 }, (_, i) => `Question ${i}?`);
    const result = await handleCanvasView(
      baseArgs({ drafted_canvas: { ...(baseArgs().drafted_canvas as object), open_questions } }),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const dc = sc.drafted_canvas as Record<string, unknown>;
    expect((dc.open_questions as string[]).length).toBe(8);
  });

  it("caps proposed_followup_message at 200 chars", async () => {
    const result = await handleCanvasView(
      baseArgs({ proposed_followup_message: "M".repeat(500) }),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.proposed_followup_message as string).length).toBeLessThanOrEqual(200);
  });
});

// ── Dual-mode resolution: action_id-only invocation lifts from `## Canvas payload` ──

describe("handleCanvasView — dual-mode (3.0.0+ on-disk payload fallback)", () => {
  function writeActionWithCanvasPayload(name: string): void {
    const frontmatter = "id: " + name + "\nstatus: open\npriority: medium\nsource: slack";
    const body = [
      "## Why this matters",
      "Test action with pre-composed canvas payload.",
      "",
      "## Canvas payload",
      "",
      "```yaml",
      "drafted_canvas:",
      "  title: \"Disk-loaded canvas title\"",
      "  tldr: \"TL;DR loaded from the action file's body section.\"",
      "  decisions:",
      "    - Disk decision 1",
      "    - Disk decision 2",
      "  open_questions:",
      "    - Disk open question 1?",
      "  participants:",
      "    - Alice",
      "    - Bob",
      "    - Carol",
      "channel:",
      "  id: C-DISK",
      "  name: disk-channel",
      "thread:",
      "  parent_ts: \"1714300000.000100\"",
      "  total_replies: 7",
      "  participants:",
      "    - Alice",
      "    - Bob",
      "proposed_followup_message: \"Disk-loaded follow-up message.\"",
      "generated_at: \"2026-04-28T09:00:00Z\"",
      "```",
    ].join("\n");
    writeFileSync(
      join(actionsDir, `${name}.md`),
      `---\n${frontmatter}\n---\n\n${body}\n`,
    );
  }

  it("invocation with only {action_id} lifts drafted_canvas, channel, thread, followup from disk", async () => {
    writeActionWithCanvasPayload("canvas-action-1");
    const result = await handleCanvasView({ action_id: "canvas-action-1" });
    const sc = result.structuredContent as Record<string, unknown>;
    const dc = sc.drafted_canvas as Record<string, unknown>;
    expect(dc.title).toBe("Disk-loaded canvas title");
    expect((dc.decisions as string[]).length).toBe(2);
    const ch = sc.channel as Record<string, unknown>;
    expect(ch.id).toBe("C-DISK");
    expect(ch.name).toBe("disk-channel");
    const thread = sc.thread as Record<string, unknown>;
    expect(thread.total_replies).toBe(7);
    expect(sc.proposed_followup_message).toBe("Disk-loaded follow-up message.");
    expect(sc.error).toBeUndefined();
  });

  it("inline drafted_canvas overrides the on-disk payload when both are present", async () => {
    writeActionWithCanvasPayload("canvas-action-1");
    const result = await handleCanvasView({
      action_id: "canvas-action-1",
      drafted_canvas: {
        title: "Inline override title",
        tldr: "Inline override tldr",
        decisions: ["Inline decision A"],
        open_questions: [],
        participants: ["Alice"],
      },
      channel: { id: "C-INLINE", name: "inline-channel" },
      thread: { parent_ts: "9999999999.000100", total_replies: 1, participants: [] },
      proposed_followup_message: "Inline override followup",
    });
    const sc = result.structuredContent as Record<string, unknown>;
    const dc = sc.drafted_canvas as Record<string, unknown>;
    expect(dc.title).toBe("Inline override title");
    const ch = sc.channel as Record<string, unknown>;
    expect(ch.id).toBe("C-INLINE");
    const thread = sc.thread as Record<string, unknown>;
    expect(thread.total_replies).toBe(1);
    expect(sc.proposed_followup_message).toBe("Inline override followup");
  });

  it("returns canvas_payload_missing when neither inline drafted_canvas nor on-disk payload exist", async () => {
    writeAction(
      "canvas-action-1",
      "id: canvas-action-1\nstatus: open\npriority: medium\nsource: slack",
      "## Why this matters\nThis action has no canvas payload.",
    );
    const result = await handleCanvasView({ action_id: "canvas-action-1" });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe("canvas_payload_missing");
  });

  it("returns canvas_payload_missing when the Canvas payload section has no fenced YAML block", async () => {
    const frontmatter = "id: canvas-action-1\nstatus: open\npriority: medium";
    const body = [
      "## Canvas payload",
      "",
      "(canvas payload not yet generated.)",
    ].join("\n");
    writeFileSync(
      join(actionsDir, "canvas-action-1.md"),
      `---\n${frontmatter}\n---\n\n${body}\n`,
    );
    const result = await handleCanvasView({ action_id: "canvas-action-1" });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe("canvas_payload_missing");
  });

  it("returns canvas_payload_missing when YAML parses but drafted_canvas.title is empty", async () => {
    const frontmatter = "id: canvas-action-1\nstatus: open\npriority: medium";
    const body = [
      "## Canvas payload",
      "",
      "```yaml",
      "drafted_canvas:",
      "  title: \"\"",
      "  tldr: \"Some tldr\"",
      "  decisions: []",
      "  open_questions: []",
      "  participants: []",
      "channel:",
      "  id: C-X",
      "  name: x",
      "thread:",
      "  parent_ts: \"123.456\"",
      "  total_replies: 0",
      "  participants: []",
      "proposed_followup_message: \"\"",
      "```",
    ].join("\n");
    writeFileSync(
      join(actionsDir, "canvas-action-1.md"),
      `---\n${frontmatter}\n---\n\n${body}\n`,
    );
    const result = await handleCanvasView({ action_id: "canvas-action-1" });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe("canvas_payload_missing");
  });
});

// ── Tool descriptor contract ─────────────────────────────────────────────────
//
// 5.1.1 regression guard. Mirrors the compose-view descriptor contract test:
// the host LLM must map the canvas trigger phrase verbatim to {action_id}
// alone, and every legacy inline-arg parameter must carry the "Do NOT pass
// for click-time trigger phrases" guard so partial inline args don't
// destructively override the on-disk `## Canvas payload` lookup.

describe("canvasViewTool — descriptor contract", () => {
  it("description maps the canvas trigger phrase to {action_id}", async () => {
    const { canvasViewTool } = await import("../src/tools/canvas-view.js");
    expect(canvasViewTool.description).toContain(
      "'open the canvas summariser for action {id}' → call with {action_id: id}",
    );
  });

  it("every legacy inline-arg parameter is labelled 'LEGACY back-compat only'", async () => {
    const { canvasViewTool } = await import("../src/tools/canvas-view.js");
    const legacy = [
      "drafted_canvas",
      "channel",
      "thread",
      "proposed_followup_message",
    ] as const;
    const props = canvasViewTool.inputSchema.properties as Record<
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
    const { canvasViewTool } = await import("../src/tools/canvas-view.js");
    const meta = canvasViewTool._meta as {
      ui: { resourceUri: string };
      "ui/resourceUri": string;
    };
    expect(meta.ui.resourceUri).toBe("ui://slack-canvas");
    expect(meta["ui/resourceUri"]).toBe("ui://slack-canvas");
  });
});

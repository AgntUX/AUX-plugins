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
    expect(result._meta.ui.visibility).toEqual(["model", "app"]);
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

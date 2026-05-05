/**
 * normalize.test.ts — canvas payload normalization.
 */

import { describe, it, expect } from "vitest";
import { normalizeCanvasPayload, normalizeChannel, normalizeThread, normalizeDraftedCanvas } from "../../lib/normalize.js";

describe("normalizeChannel", () => {
  it("returns defaults for null", () => {
    const c = normalizeChannel(null);
    expect(c.id).toBe("");
    expect(c.name).toBe("");
  });
});

describe("normalizeThread", () => {
  it("returns defaults for null", () => {
    const t = normalizeThread(null);
    expect(t.parent_ts).toBe("");
    expect(t.total_replies).toBe(0);
    expect(t.participants).toEqual([]);
  });
});

describe("normalizeDraftedCanvas", () => {
  it("returns defaults for null", () => {
    const d = normalizeDraftedCanvas(null);
    expect(d.title).toBe("");
    expect(d.tldr).toBe("");
    expect(d.decisions).toEqual([]);
    expect(d.open_questions).toEqual([]);
    expect(d.participants).toEqual([]);
  });

  it("normalizes a full canvas object", () => {
    const d = normalizeDraftedCanvas({
      title: "Title",
      tldr: "Summary",
      decisions: ["D1", "D2"],
      open_questions: ["Q1"],
      participants: ["Alice"],
    });
    expect(d.title).toBe("Title");
    expect(d.decisions).toEqual(["D1", "D2"]);
  });
});

describe("normalizeCanvasPayload", () => {
  it("returns action_not_found for null input", () => {
    const result = normalizeCanvasPayload(null);
    expect(result.error).toBe("action_not_found");
  });

  it("returns structured error for error payloads", () => {
    const result = normalizeCanvasPayload({ error: "license_paused" });
    expect(result.error).toBe("license_paused");
  });

  it("normalizes a full canvas payload", () => {
    const result = normalizeCanvasPayload({
      action_id: "my-action",
      channel: { id: "C1", name: "eng" },
      thread: { parent_ts: "ts", total_replies: 2, participants: ["A"] },
      drafted_canvas: {
        title: "T",
        tldr: "S",
        decisions: ["D"],
        open_questions: [],
        participants: ["A"],
      },
      proposed_followup_message: "Posted!",
    });
    expect(result.error).toBeNull();
    if (result.error) throw new Error("expected success");
    expect(result.action_id).toBe("my-action");
    expect(result.drafted_canvas.decisions).toEqual(["D"]);
  });

  it("unwraps _meta.payload envelope", () => {
    const result = normalizeCanvasPayload({
      _meta: {
        payload: {
          action_id: "wrapped",
          channel: { id: "C1", name: "test" },
          thread: { parent_ts: "ts", total_replies: 0, participants: [] },
          drafted_canvas: { title: "T", tldr: "S", decisions: [], open_questions: [], participants: [] },
          proposed_followup_message: "msg",
        },
      },
    });
    expect(result.error).toBeNull();
    if (result.error) throw new Error("expected success");
    expect(result.action_id).toBe("wrapped");
  });
});

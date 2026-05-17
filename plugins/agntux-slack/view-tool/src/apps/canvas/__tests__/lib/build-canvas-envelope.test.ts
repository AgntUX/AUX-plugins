/**
 * build-canvas-envelope.test.ts
 *
 * 3.0.0 contract: the envelope no longer routes through the agntux-slack
 * draft skill. It instructs the host to use the Slack Connector directly in
 * two steps (create canvas, then post link as a thread reply). Channel id
 * and thread_ts are now inline arguments — no disk read.
 */

import { describe, it, expect } from "vitest";
import {
  buildCanvasEnvelope,
  type CanvasChannel,
  type CanvasThread,
} from "../../lib/build-canvas-envelope.js";

const CHANNEL: CanvasChannel = { id: "C123", name: "general" };
const THREAD: CanvasThread = { parent_ts: "1717700000.123456" };

describe("buildCanvasEnvelope", () => {
  it("instructs the host to use the Slack Connector in two steps (create + post link)", () => {
    const result = buildCanvasEnvelope(
      "my-action",
      "My Title",
      "The tldr text.",
      ["Decision A", "Decision B"],
      ["Question 1?"],
      "Posted a summary.",
      CHANNEL,
      THREAD,
    );
    expect(result).toContain("Use the Slack Connector in two steps");
    expect(result).toContain("Create a Slack canvas titled «My Title»");
    expect(result).toContain("slack_create_canvas");
    expect(result).toContain("post it as a thread reply");
    expect(result).toContain("slack_send_message");
  });

  it("carries channel_id and thread_ts inline so the host needs no disk read", () => {
    const result = buildCanvasEnvelope("a", "T", "S", [], [], "msg", CHANNEL, THREAD);
    expect(result).toContain("channel_id: C123 (#general)");
    expect(result).toContain("thread_ts: 1717700000.123456");
  });

  it("includes the action_id as a trailing reference", () => {
    const result = buildCanvasEnvelope("my-action", "T", "S", [], [], "m", CHANNEL, THREAD);
    expect(result).toContain("(action_id: my-action)");
  });

  it("instructs the host to format the canvas link as Slack mrkdwn `<URL|title>` via placeholders (so the unescaped title is substituted)", () => {
    const result = buildCanvasEnvelope("a", "Title", "S", [], [], "m", CHANNEL, THREAD);
    expect(result).toContain("<{canvas_url}|{canvas_title}>");
    expect(result).toContain("substitute {canvas_url}");
    expect(result).toContain("substitute");
  });

  it("does NOT inline the escaped title into the mrkdwn link (would leak doubled guillemets into the Slack message)", () => {
    // Title contains a literal «» pair, which the encoder doubles inside the
    // title field. The link template MUST NOT carry the doubled form.
    const result = buildCanvasEnvelope(
      "a",
      "Foo «bar»",
      "S",
      [],
      [],
      "m",
      CHANNEL,
      THREAD,
    );
    expect(result).toContain("titled «Foo ««bar»»»");
    expect(result).not.toContain("|Foo ««bar»»>");
    expect(result).toContain("<{canvas_url}|{canvas_title}>");
  });

  it("notes that the reply will start a thread if one does not yet exist", () => {
    const result = buildCanvasEnvelope("a", "T", "S", [], [], "m", CHANNEL, THREAD);
    expect(result).toContain("if no thread exists yet on the parent message, this reply will start one");
  });

  it("encodes empty decision and question lists as JSON empty arrays", () => {
    const result = buildCanvasEnvelope("a", "T", "S", [], [], "msg", CHANNEL, THREAD);
    expect(result).toContain("decisions «[]»");
    expect(result).toContain("open_questions «[]»");
  });

  it("escapes guillemets in scalar fields by doubling (lists are NOT guillemet-escaped — JSON handles them)", () => {
    const result = buildCanvasEnvelope("a", "Title «test»", "tldr", [], [], "msg", CHANNEL, THREAD);
    expect(result).toContain("«Title ««test»»»");
  });

  it("preserves single-pipe items via JSON encoding (the bug the prior scheme had)", () => {
    const result = buildCanvasEnvelope("a", "T", "s", ["A|B", "C"], [], "m", CHANNEL, THREAD);
    expect(result).toContain('decisions «["A|B","C"]»');
    const match = result.match(/decisions «(.*?)»/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed).toEqual(["A|B", "C"]);
  });

  it("preserves a single-item list correctly", () => {
    const result = buildCanvasEnvelope("a", "T", "s", ["Only decision"], [], "m", CHANNEL, THREAD);
    expect(result).toContain('decisions «["Only decision"]»');
  });

  it("preserves items containing JSON-special characters (quotes, backslashes)", () => {
    const items = ['He said "hi"', "path\\to\\file"];
    const result = buildCanvasEnvelope("a", "T", "s", items, [], "m", CHANNEL, THREAD);
    const match = result.match(/decisions «(.*?)»/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed).toEqual(items);
  });

  it("preserves items containing newlines", () => {
    const items = ["line one\nline two"];
    const result = buildCanvasEnvelope("a", "T", "s", items, [], "m", CHANNEL, THREAD);
    const match = result.match(/decisions «(.*?)»/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed).toEqual(items);
  });

  it("preserves items containing literal '||' (double-pipe, e.g., a markdown table separator)", () => {
    const items = ["D1 || stuff", "D2"];
    const result = buildCanvasEnvelope("a", "T", "s", items, [], "m", CHANNEL, THREAD);
    const match = result.match(/decisions «(.*?)»/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed).toEqual(items);
  });

  it("does NOT name the agntux-slack plugin (3.0.0 contract — host targets the connector directly)", () => {
    const result = buildCanvasEnvelope("a", "T", "S", [], [], "m", CHANNEL, THREAD);
    expect(result).not.toMatch(/agntux-slack plugin/);
  });
});

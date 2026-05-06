/**
 * build-envelope.test.ts
 *
 * Tests for the 3.0.0 host_prompt envelope builder. The envelope now targets
 * the user's Slack Connector directly (no agntux-slack draft skill round-trip)
 * and carries channel_id + thread_ts inline so the host can act with no disk
 * read.
 */

import { describe, it, expect } from "vitest";
import { buildEnvelope, type ComposeChannel, type ComposeThread } from "../../lib/build-envelope.js";

const CHANNEL: ComposeChannel = { id: "C123", name: "general", is_dm: false };
const DM_CHANNEL: ComposeChannel = { id: "D456", name: "ada", is_dm: true };
const THREAD: ComposeThread = { parent_ts: "1717700000.123456" };

describe("buildEnvelope", () => {
  it("send mode targets the Slack Connector with channel_id + thread_ts", () => {
    const result = buildEnvelope("my-action", "send", "Hello world", CHANNEL, THREAD);
    expect(result).toContain("Use the Slack Connector to send a Slack message as a thread reply");
    expect(result).toContain("channel_id: C123 (#general)");
    expect(result).toContain("thread_ts: 1717700000.123456");
    expect(result).toContain("Body: «Hello world»");
    expect(result).toContain("(action_id: my-action)");
  });

  it("save_draft mode instructs the host to save (NOT send) and to reply in-thread", () => {
    const result = buildEnvelope("my-action", "save_draft", "draft body", CHANNEL, THREAD);
    expect(result).toContain("save a Slack draft (do NOT send)");
    expect(result).toContain("Save as draft only — do not send");
    expect(result).toContain("channel_id: C123");
    expect(result).toContain("thread_ts: 1717700000.123456");
    expect(result).toContain("«draft body»");
  });

  it("schedule mode includes send_at and routes through the Slack Connector", () => {
    const result = buildEnvelope(
      "my-action",
      "schedule",
      "See you tomorrow",
      CHANNEL,
      THREAD,
      "2026-05-05T09:00:00.000Z",
    );
    expect(result).toContain("schedule a Slack message as a thread reply");
    expect(result).toContain("send_at: 2026-05-05T09:00:00.000Z");
    expect(result).toContain("«See you tomorrow»");
  });

  it("schedule mode without send_at falls back to send (UI-side guard against regressions)", () => {
    const result = buildEnvelope("my-action", "schedule", "body", CHANNEL, THREAD);
    expect(result).toContain("send a Slack message as a thread reply");
    expect(result).not.toContain("send_at");
  });

  it("includes a threading note that creates a thread on the parent if one does not exist yet", () => {
    const result = buildEnvelope("a", "send", "b", CHANNEL, THREAD);
    expect(result).toContain("if no thread exists yet on the parent message, this reply will start one when posted");
  });

  it("DM channels render without a leading # but still include the channel name", () => {
    const result = buildEnvelope("a", "send", "hi", DM_CHANNEL, THREAD);
    expect(result).toContain("channel_id: D456 (ada)");
    expect(result).not.toContain("(#ada)");
  });

  it("escapes literal « in the body by doubling", () => {
    const result = buildEnvelope("my-action", "send", "Hello «world»", CHANNEL, THREAD);
    expect(result).toContain("«Hello ««world»»»");
  });

  it("escapes multiple guillemets", () => {
    const result = buildEnvelope("my-action", "send", "«a» and «b»", CHANNEL, THREAD);
    expect(result).toContain("««a»»");
    expect(result).toContain("««b»»");
  });

  it("ignores send_at for non-schedule mode even when provided", () => {
    const result = buildEnvelope("my-action", "send", "body", CHANNEL, THREAD, "2026-05-05T09:00:00Z");
    expect(result).not.toContain("send_at");
  });

  it("handles empty body without crashing", () => {
    const result = buildEnvelope("my-action", "send", "", CHANNEL, THREAD);
    expect(result).toContain("«»");
  });

  it("does NOT name the agntux-slack plugin (3.0.0 contract — host targets the connector directly)", () => {
    const result = buildEnvelope("a", "send", "b", CHANNEL, THREAD);
    expect(result).not.toMatch(/agntux-slack plugin/);
  });
});

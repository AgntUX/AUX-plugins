/**
 * normalize.test.ts — defensive defaults, missing fields, type coercion.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeComposePayload,
  normalizeChannel,
  normalizeThread,
  normalizeMessage,
} from "../../lib/normalize.js";

describe("normalizeChannel", () => {
  it("returns defaults for missing input", () => {
    const c = normalizeChannel(null);
    expect(c.id).toBe("");
    expect(c.name).toBe("");
    expect(c.is_dm).toBe(false);
  });

  it("passes through valid channel object", () => {
    const c = normalizeChannel({ id: "C123", name: "general", is_dm: false });
    expect(c.id).toBe("C123");
    expect(c.name).toBe("general");
    expect(c.is_dm).toBe(false);
  });

  it("defaults is_dm to false when not a boolean", () => {
    const c = normalizeChannel({ id: "D123", name: "dm", is_dm: "yes" });
    expect(c.is_dm).toBe(false);
  });
});

describe("normalizeThread", () => {
  it("returns defaults for null input", () => {
    const t = normalizeThread(null);
    expect(t.parent_ts).toBe("");
    expect(t.total_replies).toBe(0);
    expect(t.participants).toEqual([]);
    expect(t.last_reply_ts).toBeNull();
  });

  it("preserves null for optional string-or-null fields", () => {
    const t = normalizeThread({
      parent_ts: "ts",
      parent_author_real_name: "Alice",
      parent_excerpt: "hi",
      last_reply_ts: null,
      last_reply_author_real_name: null,
      last_reply_excerpt: null,
      total_replies: 0,
      participants: [],
    });
    expect(t.last_reply_ts).toBeNull();
    expect(t.last_reply_author_real_name).toBeNull();
    expect(t.last_reply_excerpt).toBeNull();
  });
});

describe("normalizeMessage", () => {
  it("defaults all fields for empty input", () => {
    const m = normalizeMessage({});
    expect(m.ts).toBe("");
    expect(m.author).toBe("");
    expect(m.body_excerpt).toBe("");
  });
});

describe("normalizeComposePayload", () => {
  it("returns action_not_found error for null input", () => {
    const result = normalizeComposePayload(null);
    expect(result.error).toBe("action_not_found");
  });

  it("unwraps _meta.payload envelope", () => {
    const raw = {
      _meta: {
        payload: {
          action_id: "wrapped-id",
          initial_verb: "draft",
          channel: { id: "C1", name: "test", is_dm: false },
          thread: {
            parent_ts: "ts",
            parent_author_real_name: "A",
            parent_excerpt: "ex",
            last_reply_ts: null,
            last_reply_author_real_name: null,
            last_reply_excerpt: null,
            total_replies: 0,
            participants: [],
          },
          messages_preview: [],
          messages_truncated: false,
          drafted_body: "hello",
          personalization_signals: [],
          proposed_send_time: null,
          slack_permalink: null,
        },
      },
    };
    const result = normalizeComposePayload(raw);
    expect(result.error).toBeNull();
    if (result.error) throw new Error("expected success");
    expect(result.action_id).toBe("wrapped-id");
  });

  it("coerces unknown initial_verb to draft", () => {
    const result = normalizeComposePayload({
      action_id: "a",
      initial_verb: "fax",
      channel: {},
      thread: {},
      messages_preview: [],
      messages_truncated: false,
      drafted_body: "",
      personalization_signals: [],
      proposed_send_time: null,
      slack_permalink: null,
    });
    if (result.error) throw new Error("expected success");
    expect(result.initial_verb).toBe("draft");
  });

  it("returns structured error for known error values", () => {
    const result = normalizeComposePayload({ error: "action_already_handled" });
    expect(result.error).toBe("action_already_handled");
  });

  it("defaults messages_preview to [] for missing field", () => {
    const result = normalizeComposePayload({
      action_id: "a",
      initial_verb: "draft",
      channel: { id: "C1", name: "test", is_dm: false },
      thread: {},
      drafted_body: "",
      personalization_signals: [],
      proposed_send_time: null,
      slack_permalink: null,
    });
    if (result.error) throw new Error("expected success");
    expect(result.messages_preview).toEqual([]);
  });
});

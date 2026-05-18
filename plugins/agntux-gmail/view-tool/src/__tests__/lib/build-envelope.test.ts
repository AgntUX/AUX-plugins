/**
 * build-envelope.test.ts
 *
 * Tests for the gmail compose host_prompt envelope builder. The envelope
 * targets the user's Gmail Connector directly (create_draft + chat link)
 * with all fields inline.
 *
 * 4.2.0 adds the native-UI suppression directive so the host doesn't
 * render Gmail's native draft-create MCP App UI on top of the AgntUX
 * compose iframe the user just used.
 */

import { describe, it, expect } from "vitest";
import {
  buildEnvelope,
  type ComposeEnvelopeRecipients,
} from "../../lib/build-envelope.js";

const RECIPIENTS: ComposeEnvelopeRecipients = {
  to: ["a@example.com"],
  cc: [],
  bcc: [],
};

describe("buildEnvelope (gmail)", () => {
  it("targets the Gmail Connector and carries create_draft fields inline", () => {
    const result = buildEnvelope(
      "my-action",
      "Re: launch",
      "Hello, see attached.",
      RECIPIENTS,
      "msg-id-123",
      "user@example.com",
      null,
    );
    expect(result).toContain("Use the Gmail Connector in two steps");
    expect(result).toContain("Call create_draft");
    expect(result).toContain("replyToMessageId: msg-id-123");
    expect(result).toContain("to: [a@example.com]");
    expect(result).toContain("subject: «Re: launch»");
    expect(result).toContain("body: «Hello, see attached.»");
    expect(result).toContain("(action_id: my-action)");
  });

  it("respects account_index precedence for the chat link template", () => {
    const result = buildEnvelope(
      "a",
      "s",
      "b",
      RECIPIENTS,
      "",
      "user@example.com",
      2,
    );
    expect(result).toContain("mail/u/2/#drafts/<draft_id>");
  });

  it("falls back to authuser= when account_index is null but user_email is known", () => {
    const result = buildEnvelope(
      "a",
      "s",
      "b",
      RECIPIENTS,
      "",
      "user@example.com",
      null,
    );
    expect(result).toContain("authuser=user%40example.com");
  });

  it("cold-start: falls back to mail/u/0 when both account_index and user_email are null", () => {
    const result = buildEnvelope("a", "s", "b", RECIPIENTS, "", null, null);
    expect(result).toContain("mail/u/0/#drafts/<draft_id>");
  });

  // 4.2.0 — native-UI suppression directive
  describe("no-native-UI directive (4.2.0)", () => {
    it("appends the directive to the envelope", () => {
      const result = buildEnvelope(
        "a",
        "s",
        "b",
        RECIPIENTS,
        "",
        null,
        null,
      );
      expect(result).toContain("do NOT render any Gmail Connector MCP App UI");
      expect(result).toContain("do NOT re-render the AgntUX compose UI");
      expect(result).toContain("return its success/error to chat as plain text");
    });
  });
});

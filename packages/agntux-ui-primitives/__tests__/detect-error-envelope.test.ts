import { describe, expect, it } from "vitest";
import { detectErrorEnvelope } from "../src/detect-error-envelope.js";

describe("detectErrorEnvelope", () => {
  it("returns null for undefined input", () => {
    expect(detectErrorEnvelope(undefined)).toBe(null);
  });

  it("returns null for empty object", () => {
    expect(detectErrorEnvelope({})).toBe(null);
  });

  it("returns null when payload-shaped keys are present without _isError", () => {
    expect(
      detectErrorEnvelope({
        actions: [],
        _content: [{ type: "text", text: "ignored" }],
      }),
    ).toBe(null);
  });

  it("extracts the text via the _isError signal even with payload keys", () => {
    expect(
      detectErrorEnvelope({
        actions: [],
        _isError: true,
        _content: [{ type: "text", text: "Atlassian rate limit (429)." }],
      }),
    ).toBe("Atlassian rate limit (429).");
  });

  it("returns null when _isError is explicitly false (even if shape would heuristic-match)", () => {
    // An explicit `_isError: false` overrides the heuristic — the adapter
    // is signalling "this is a normal payload, not an error envelope" so
    // we must NOT surface the text as an error.
    expect(
      detectErrorEnvelope({
        _isError: false,
        _content: [{ type: "text", text: "should not surface" }],
      }),
    ).toBe(null);
  });

  it("extracts the text from a metadata-only envelope (heuristic path)", () => {
    const envelope = {
      _content: [
        {
          type: "text",
          text: "Auth failed.\nReconnect Jira from Customize → Connectors.",
        },
      ],
    };
    expect(detectErrorEnvelope(envelope)).toBe(
      "Auth failed.\nReconnect Jira from Customize → Connectors.",
    );
  });

  it("tolerates _meta alongside _content", () => {
    const envelope = {
      _content: [{ type: "text", text: "Upstream 502." }],
      _meta: { code: "upstream_5xx" },
    };
    expect(detectErrorEnvelope(envelope)).toBe("Upstream 502.");
  });

  it("returns null when _content is empty", () => {
    expect(detectErrorEnvelope({ _content: [] })).toBe(null);
  });

  it("returns null when first content item is not text", () => {
    expect(
      detectErrorEnvelope({ _content: [{ type: "image", text: "" }] }),
    ).toBe(null);
  });

  it("returns null when text is empty string", () => {
    expect(detectErrorEnvelope({ _content: [{ type: "text", text: "" }] })).toBe(
      null,
    );
  });
});

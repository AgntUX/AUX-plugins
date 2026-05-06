import { describe, expect, it } from "vitest";
import { detectErrorEnvelope } from "../src/detect-error-envelope.js";

describe("detectErrorEnvelope", () => {
  it("returns null for undefined input", () => {
    expect(detectErrorEnvelope(undefined)).toBe(null);
  });

  it("returns null for empty object", () => {
    expect(detectErrorEnvelope({})).toBe(null);
  });

  it("returns null when payload-shaped keys are present", () => {
    expect(
      detectErrorEnvelope({
        actions: [],
        _content: [{ type: "text", text: "ignored" }],
      }),
    ).toBe(null);
  });

  it("extracts the text from a license-gate envelope", () => {
    const envelope = {
      _content: [
        {
          type: "text",
          text: "Pairing required.\nVisit https://agntux.ai to pair.",
        },
      ],
    };
    expect(detectErrorEnvelope(envelope)).toBe(
      "Pairing required.\nVisit https://agntux.ai to pair.",
    );
  });

  it("tolerates _meta alongside _content", () => {
    const envelope = {
      _content: [{ type: "text", text: "Trial expired." }],
      _meta: { code: "trial_expired" },
    };
    expect(detectErrorEnvelope(envelope)).toBe("Trial expired.");
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

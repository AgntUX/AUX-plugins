/**
 * build-canvas-envelope.test.ts
 *
 * Tests the JSON-based list encoding (replacing the prior `||`-doubling/join
 * scheme that had a single-pipe correctness gap — an item containing a
 * single literal `|` could not round-trip).
 */

import { describe, it, expect } from "vitest";
import { buildCanvasEnvelope } from "../../lib/build-canvas-envelope.js";

describe("buildCanvasEnvelope", () => {
  it("produces the correct envelope shape with JSON-encoded lists", () => {
    const result = buildCanvasEnvelope(
      "my-action",
      "My Title",
      "The tldr text.",
      ["Decision A", "Decision B"],
      ["Question 1?"],
      "Posted a summary.",
    );
    expect(result).toBe(
      "ux: Use the agntux-slack plugin to commit the drafted canvas for action my-action" +
        " with title «My Title»" +
        ", tldr «The tldr text.»" +
        ', decisions «["Decision A","Decision B"]»' +
        ', open_questions «["Question 1?"]»' +
        ", followup_message «Posted a summary.».",
    );
  });

  it("encodes empty decision and question lists as JSON empty arrays", () => {
    const result = buildCanvasEnvelope("a", "T", "S", [], [], "msg");
    expect(result).toContain("decisions «[]»");
    expect(result).toContain("open_questions «[]»");
  });

  it("escapes guillemets in scalar fields by doubling (lists are NOT guillemet-escaped — JSON handles them)", () => {
    const result = buildCanvasEnvelope("a", "Title «test»", "tldr", [], [], "msg");
    expect(result).toContain("«Title ««test»»»");
  });

  it("preserves single-pipe items via JSON encoding (the bug the prior scheme had)", () => {
    // The prior `||`-doubling scheme could not round-trip "A|B" — it would
    // encode to "A||B" which was indistinguishable from a two-item list when
    // joined with the item separator "||". JSON sidesteps this: a literal "|"
    // is just a character in a JSON string.
    const result = buildCanvasEnvelope("a", "T", "s", ["A|B", "C"], [], "m");
    expect(result).toContain('decisions «["A|B","C"]»');
    const match = result.match(/decisions «(.*?)»/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed).toEqual(["A|B", "C"]);
  });

  it("preserves a single-item list correctly", () => {
    const result = buildCanvasEnvelope("a", "T", "s", ["Only decision"], [], "m");
    expect(result).toContain('decisions «["Only decision"]»');
  });

  it("preserves items containing JSON-special characters (quotes, backslashes)", () => {
    const items = ['He said "hi"', "path\\to\\file"];
    const result = buildCanvasEnvelope("a", "T", "s", items, [], "m");
    const match = result.match(/decisions «(.*?)»/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed).toEqual(items);
  });

  it("preserves items containing newlines", () => {
    const items = ["line one\nline two"];
    const result = buildCanvasEnvelope("a", "T", "s", items, [], "m");
    const match = result.match(/decisions «(.*?)»/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed).toEqual(items);
  });

  it("preserves items containing literal '||' (double-pipe, e.g., a markdown table separator)", () => {
    const items = ["D1 || stuff", "D2"];
    const result = buildCanvasEnvelope("a", "T", "s", items, [], "m");
    const match = result.match(/decisions «(.*?)»/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed).toEqual(items);
  });
});

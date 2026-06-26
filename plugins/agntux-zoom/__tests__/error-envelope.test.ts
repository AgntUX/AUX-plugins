/**
 * error-envelope.test.ts — agntux-zoom
 *
 * Asserts that the save-doc iframe surfaces runtime error envelopes cleanly.
 * When the view-tool handler returns a { isError: true, content: [...] }
 * envelope (rate limit, auth failure, upstream 5xx), the App.tsx component
 * short-circuits via detectErrorEnvelope and renders ServerErrorScreen with
 * the full error message via whitespace-pre-wrap.
 *
 * GOLDEN RULE: every assertion is derived from reading App.tsx verbatim
 * (golden rule #1). No prose from _overrides/ is grepped (E30 rule).
 *
 * Grounding source: view-tool/src/App.tsx (the actual authored file).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const APP_TSX_PATH = join(PLUGIN_ROOT, "view-tool/src/App.tsx");

describe("server-error envelope rendering — App.tsx", () => {
  it("App.tsx imports detectErrorEnvelope from @agntux/ui-primitives", () => {
    const src = readFileSync(APP_TSX_PATH, "utf-8");
    // Verbatim from App.tsx line 26.
    expect(src).toContain("detectErrorEnvelope");
    expect(src).toContain('from "@agntux/ui-primitives"');
  });

  it("App.tsx imports ServerErrorScreen from @agntux/ui-primitives", () => {
    const src = readFileSync(APP_TSX_PATH, "utf-8");
    // Verbatim from App.tsx line 25.
    expect(src).toContain("ServerErrorScreen");
  });

  it("App.tsx calls detectErrorEnvelope on the tool output", () => {
    const src = readFileSync(APP_TSX_PATH, "utf-8");
    // Verbatim from App.tsx line 64.
    expect(src).toContain("const errorEnvelope = detectErrorEnvelope(");
  });

  it("App.tsx short-circuits and renders ServerErrorScreen when an error envelope is detected", () => {
    const src = readFileSync(APP_TSX_PATH, "utf-8");
    // Verbatim from App.tsx lines 65-73: the if-block that returns ServerErrorScreen.
    expect(src).toContain("if (errorEnvelope)");
    expect(src).toContain("<ServerErrorScreen");
  });

  it("App.tsx passes errorEnvelope as the message prop to ServerErrorScreen", () => {
    const src = readFileSync(APP_TSX_PATH, "utf-8");
    // Verbatim from App.tsx line 69.
    expect(src).toContain("message={errorEnvelope}");
  });

  it("App.tsx imports ComponentErrorBoundary from @agntux/ui-primitives", () => {
    const src = readFileSync(APP_TSX_PATH, "utf-8");
    // Verbatim from App.tsx line 24.
    expect(src).toContain("ComponentErrorBoundary");
  });
});

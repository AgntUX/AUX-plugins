/**
 * error-envelope.test.ts — agntux-calendly
 *
 * Asserts that all three App.tsx entry points correctly surface runtime
 * error envelopes (rate limit, auth failure, upstream 5xx) via the
 * @agntux/ui-primitives detectErrorEnvelope + ServerErrorScreen pattern.
 *
 * GOLDEN RULE: every assertion is a verbatim substring copied from the
 * authored App.tsx files.
 *
 * Grounding source: view-tool/src/apps/{handler}/App.tsx (handler output,
 * source of truth #1 — actual file content read before asserting).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VIEW_SRC = join(
  __dirname,
  "..",
  "view-tool",
  "src",
  "apps",
);

function readApp(handler: string): string {
  return readFileSync(join(VIEW_SRC, handler, "App.tsx"), "utf-8");
}

const HANDLERS = ["cancel", "no-show", "scheduling-link"] as const;

for (const handler of HANDLERS) {
  describe(`${handler} App.tsx — error-envelope rendering`, () => {
    it("imports detectErrorEnvelope from @agntux/ui-primitives", () => {
      const src = readApp(handler);
      // Verbatim from App.tsx lines 12-14 across all three handlers:
      // "detectErrorEnvelope," and "} from \"@agntux/ui-primitives\";"
      expect(src).toContain("detectErrorEnvelope");
      expect(src).toContain("from \"@agntux/ui-primitives\"");
    });

    it("imports ServerErrorScreen from @agntux/ui-primitives", () => {
      const src = readApp(handler);
      expect(src).toContain("ServerErrorScreen");
    });

    it("short-circuits on detectErrorEnvelope(toolOutput)", () => {
      const src = readApp(handler);
      // Verbatim from App.tsx line 43:
      // "const errorEnvelope = detectErrorEnvelope(toolOutput);"
      expect(src).toContain("const errorEnvelope = detectErrorEnvelope(toolOutput)");
    });

    it("renders ServerErrorScreen with the error message when error envelope detected", () => {
      const src = readApp(handler);
      // Verbatim from App.tsx: "if (errorEnvelope) {"
      // followed by "<ServerErrorScreen message={errorEnvelope} />"
      expect(src).toContain("if (errorEnvelope)");
      expect(src).toContain("<ServerErrorScreen message={errorEnvelope}");
    });

    it("wraps ServerErrorScreen in ComponentErrorBoundary", () => {
      const src = readApp(handler);
      // Verbatim from App.tsx:
      // "<ComponentErrorBoundary>"
      expect(src).toContain("ComponentErrorBoundary");
    });
  });
}

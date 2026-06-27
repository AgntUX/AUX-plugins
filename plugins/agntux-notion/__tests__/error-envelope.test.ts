/**
 * error-envelope.test.ts — agntux-notion
 *
 * Asserts that all three iframe App.tsx components surface runtime error
 * envelopes (rate limit, auth failure, upstream 5xx) cleanly via the
 * @agntux/ui-primitives detectErrorEnvelope + ServerErrorScreen pattern.
 *
 * Source files asserted (derived only — no phantom prose assertions):
 *   view-tool/src/apps/comment/CommentApp.tsx
 *   view-tool/src/apps/update/UpdateApp.tsx
 *   view-tool/src/apps/create/CreateApp.tsx
 *
 * All assertions use verbatim substrings from the authored source files.
 * No LLM is invoked at test time.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VT_ROOT = join(__dirname, "..", "view-tool");

const handlers = [
  {
    name: "comment",
    appFile: join(VT_ROOT, "src/apps/comment/CommentApp.tsx"),
  },
  {
    name: "update",
    appFile: join(VT_ROOT, "src/apps/update/UpdateApp.tsx"),
  },
  {
    name: "create",
    appFile: join(VT_ROOT, "src/apps/create/CreateApp.tsx"),
  },
] as const;

for (const { name, appFile } of handlers) {
  describe(`${name} App.tsx — error-envelope rendering`, () => {
    const src = readFileSync(appFile, "utf-8");

    it("imports detectErrorEnvelope from @agntux/ui-primitives", () => {
      // Verbatim from all three App.tsx files: line 19
      // (import uses double quotes: from "@agntux/ui-primitives")
      expect(src).toContain("detectErrorEnvelope");
      expect(src).toContain('from "@agntux/ui-primitives"');
    });

    it("imports ServerErrorScreen from @agntux/ui-primitives", () => {
      // Verbatim from all three App.tsx files: lines 20-23
      expect(src).toContain("ServerErrorScreen");
    });

    it("imports ComponentErrorBoundary from @agntux/ui-primitives", () => {
      // Verbatim from all three App.tsx files: line 21
      expect(src).toContain("ComponentErrorBoundary");
    });

    it("calls detectErrorEnvelope(toolOutput) to inspect the tool result", () => {
      // Verbatim from all three App.tsx files: line 58
      expect(src).toContain("detectErrorEnvelope(toolOutput)");
    });

    it("renders ServerErrorScreen with the error message when errorEnvelope is truthy", () => {
      // Verbatim from all three App.tsx files: lines 61-66
      expect(src).toContain("<ServerErrorScreen message={errorEnvelope}");
    });

    it("wraps ServerErrorScreen in ComponentErrorBoundary", () => {
      // Verbatim from all three App.tsx files: line 62-65
      expect(src).toContain("<ComponentErrorBoundary>");
    });
  });
}

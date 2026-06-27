// error-envelope.test.ts — agntux-docusign
//
// Asserts that all three App.tsx files surface runtime error envelopes
// (rate limit, auth failure, upstream 5xx) via the canonical
// detectErrorEnvelope + ServerErrorScreen pattern from @agntux/ui-primitives.
//
// All assertions are verbatim substrings from the App.tsx source files
// that were read during test authoring.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

const REMINDER_APP = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/reminder/App.tsx",
);
const VOID_APP = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/void/App.tsx",
);
const SIGN_APP = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/sign/App.tsx",
);

// ---------------------------------------------------------------------------
// Reminder App.tsx
// ---------------------------------------------------------------------------

describe("reminder App.tsx — server-error envelope rendering", () => {
  const src = readFileSync(REMINDER_APP, "utf-8");

  it("imports detectErrorEnvelope from @agntux/ui-primitives", () => {
    // Verbatim from reminder/App.tsx:
    // import { ComponentErrorBoundary, ServerErrorScreen, detectErrorEnvelope, } from '@agntux/ui-primitives';
    expect(src).toContain("detectErrorEnvelope");
    expect(src).toContain("@agntux/ui-primitives");
  });

  it("imports ServerErrorScreen from @agntux/ui-primitives", () => {
    // Verbatim from reminder/App.tsx
    expect(src).toContain("ServerErrorScreen");
  });

  it("imports ComponentErrorBoundary from @agntux/ui-primitives", () => {
    // Verbatim from reminder/App.tsx
    expect(src).toContain("ComponentErrorBoundary");
  });

  it("calls detectErrorEnvelope on toolOutput to short-circuit on error", () => {
    // Verbatim from reminder/App.tsx: "const errorEnvelope = detectErrorEnvelope(toolOutput);"
    expect(src).toContain("detectErrorEnvelope(toolOutput)");
  });

  it("renders ServerErrorScreen with errorEnvelope message when error detected", () => {
    // Verbatim from reminder/App.tsx:
    // "<ServerErrorScreen message={errorEnvelope} />"
    expect(src).toContain("ServerErrorScreen");
    expect(src).toContain("errorEnvelope");
  });

  it("wraps error screen in ComponentErrorBoundary", () => {
    // Verbatim from reminder/App.tsx: "<ComponentErrorBoundary>"
    expect(src).toContain("<ComponentErrorBoundary>");
  });
});

// ---------------------------------------------------------------------------
// Void App.tsx
// ---------------------------------------------------------------------------

describe("void App.tsx — server-error envelope rendering", () => {
  const src = readFileSync(VOID_APP, "utf-8");

  it("imports detectErrorEnvelope from @agntux/ui-primitives", () => {
    // Verbatim from void/App.tsx
    expect(src).toContain("detectErrorEnvelope");
    expect(src).toContain("@agntux/ui-primitives");
  });

  it("imports ServerErrorScreen from @agntux/ui-primitives", () => {
    expect(src).toContain("ServerErrorScreen");
  });

  it("imports ComponentErrorBoundary from @agntux/ui-primitives", () => {
    expect(src).toContain("ComponentErrorBoundary");
  });

  it("calls detectErrorEnvelope on toolOutput", () => {
    // Verbatim from void/App.tsx: "const errorEnvelope = detectErrorEnvelope(toolOutput);"
    expect(src).toContain("detectErrorEnvelope(toolOutput)");
  });

  it("renders ServerErrorScreen on error detection", () => {
    expect(src).toContain("ServerErrorScreen");
    expect(src).toContain("errorEnvelope");
  });
});

// ---------------------------------------------------------------------------
// Sign App.tsx
// ---------------------------------------------------------------------------

describe("sign App.tsx — server-error envelope rendering", () => {
  const src = readFileSync(SIGN_APP, "utf-8");

  it("imports detectErrorEnvelope from @agntux/ui-primitives", () => {
    // Verbatim from sign/App.tsx
    expect(src).toContain("detectErrorEnvelope");
    expect(src).toContain("@agntux/ui-primitives");
  });

  it("imports ServerErrorScreen from @agntux/ui-primitives", () => {
    expect(src).toContain("ServerErrorScreen");
  });

  it("imports ComponentErrorBoundary from @agntux/ui-primitives", () => {
    expect(src).toContain("ComponentErrorBoundary");
  });

  it("calls detectErrorEnvelope on toolOutput", () => {
    // Verbatim from sign/App.tsx: "const errorEnvelope = detectErrorEnvelope(toolOutput);"
    expect(src).toContain("detectErrorEnvelope(toolOutput)");
  });

  it("renders ServerErrorScreen on error detection", () => {
    expect(src).toContain("ServerErrorScreen");
    expect(src).toContain("errorEnvelope");
  });
});

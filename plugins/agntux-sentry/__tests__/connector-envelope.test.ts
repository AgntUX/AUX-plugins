/**
 * connector-envelope.test.ts — agntux-sentry
 *
 * Asserts that all three view-tool envelope builders (resolve, ignore, assign)
 * target the Sentry Connector directly and include the NO_NATIVE_UI suppression
 * directive. These are static-grep assertions against the source files —
 * no LLM or live tool invocation at test time.
 *
 * All asserted strings are verbatim substrings confirmed by reading the
 * source files before authoring:
 *   view-tool/src/apps/resolve/lib/build-envelope.ts
 *   view-tool/src/apps/ignore/lib/build-envelope.ts
 *   view-tool/src/apps/assign/lib/build-envelope.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

const resolveEnvelope = readFileSync(
  join(PLUGIN_ROOT, "view-tool/src/apps/resolve/lib/build-envelope.ts"),
  "utf-8",
);
const ignoreEnvelope = readFileSync(
  join(PLUGIN_ROOT, "view-tool/src/apps/ignore/lib/build-envelope.ts"),
  "utf-8",
);
const assignEnvelope = readFileSync(
  join(PLUGIN_ROOT, "view-tool/src/apps/assign/lib/build-envelope.ts"),
  "utf-8",
);

// ── describe: connector-direct targeting ─────────────────────────────────────

describe("connector-direct targeting — all three envelope builders", () => {
  it("resolve envelope targets the Sentry Connector via update_issue", () => {
    // Verbatim from resolve/lib/build-envelope.ts
    expect(resolveEnvelope).toContain("Sentry Connector");
    expect(resolveEnvelope).toContain("update_issue");
  });

  it("ignore envelope targets the Sentry Connector via update_issue", () => {
    // Verbatim from ignore/lib/build-envelope.ts
    expect(ignoreEnvelope).toContain("Sentry Connector");
    expect(ignoreEnvelope).toContain("update_issue");
  });

  it("assign envelope targets the Sentry Connector via update_issue", () => {
    // Verbatim from assign/lib/build-envelope.ts
    expect(assignEnvelope).toContain("Sentry Connector");
    expect(assignEnvelope).toContain("update_issue");
  });
});

// ── describe: NO_NATIVE_UI suppression directive ──────────────────────────────

describe("NO_NATIVE_UI suppression — connector's own UI suppressed after iframe submit", () => {
  it("resolve envelope carries NO_NATIVE_UI directive", () => {
    // Verbatim constant name from resolve/lib/build-envelope.ts
    expect(resolveEnvelope).toContain("NO_NATIVE_UI");
  });

  it("ignore envelope carries NO_NATIVE_UI directive", () => {
    // Verbatim constant name from ignore/lib/build-envelope.ts
    expect(ignoreEnvelope).toContain("NO_NATIVE_UI");
  });

  it("assign envelope carries NO_NATIVE_UI directive", () => {
    // Verbatim constant name from assign/lib/build-envelope.ts
    expect(assignEnvelope).toContain("NO_NATIVE_UI");
  });

  it("resolve NO_NATIVE_UI instructs programmatic execution, not native UI render", () => {
    // Verbatim substrings from resolve/lib/build-envelope.ts NO_NATIVE_UI_DIRECTIVE.
    // The constant is built from concatenated string literals — each asserted
    // fragment must be present within a single source line (no cross-line spans).
    // "Execute the Sentry Connector tool programmatically" lives on line 21.
    // "Connector MCP App UI for this call" lives on line 23.
    expect(resolveEnvelope).toContain(
      "Execute the Sentry Connector tool programmatically",
    );
    expect(resolveEnvelope).toContain(
      "Connector MCP App UI for this call",
    );
  });

  it("ignore NO_NATIVE_UI instructs programmatic execution, not native UI render", () => {
    // Verbatim substrings from ignore/lib/build-envelope.ts NO_NATIVE_UI_DIRECTIVE.
    // Same line-split structure as resolve; fragments confirmed by read.
    expect(ignoreEnvelope).toContain(
      "Execute the Sentry Connector tool programmatically",
    );
    expect(ignoreEnvelope).toContain(
      "Connector MCP App UI for this call",
    );
  });

  it("assign NO_NATIVE_UI instructs programmatic execution, not native UI render", () => {
    // Verbatim substrings from assign/lib/build-envelope.ts NO_NATIVE_UI_DIRECTIVE.
    // Same line-split structure as resolve; fragments confirmed by read.
    expect(assignEnvelope).toContain(
      "Execute the Sentry Connector tool programmatically",
    );
    expect(assignEnvelope).toContain(
      "Connector MCP App UI for this call",
    );
  });
});

// ── describe: resolve-specific parameters ────────────────────────────────────

describe("resolve envelope — status values", () => {
  it("resolve envelope emits 'resolved' for immediate resolution", () => {
    // Verbatim from resolve/lib/build-envelope.ts buildEnvelope()
    expect(resolveEnvelope).toContain('"resolved"');
  });

  it("resolve envelope emits 'resolvedInNextRelease' for deferred resolution", () => {
    // Verbatim from resolve/lib/build-envelope.ts buildEnvelope()
    expect(resolveEnvelope).toContain('"resolvedInNextRelease"');
  });
});

// ── describe: ignore-specific mode labels ────────────────────────────────────

describe("ignore envelope — mode labels", () => {
  it("ignore envelope covers untilEscalating mode", () => {
    // Verbatim from ignore/lib/build-envelope.ts MODE_LABELS
    expect(ignoreEnvelope).toContain("untilEscalating");
  });

  it("ignore envelope covers forever mode", () => {
    // Verbatim from ignore/lib/build-envelope.ts MODE_LABELS
    expect(ignoreEnvelope).toContain("forever");
  });

  it("ignore envelope covers forDuration mode", () => {
    // Verbatim from ignore/lib/build-envelope.ts MODE_LABELS
    expect(ignoreEnvelope).toContain("forDuration");
  });

  it("ignore envelope covers untilOccurrenceCount mode", () => {
    // Verbatim from ignore/lib/build-envelope.ts MODE_LABELS
    expect(ignoreEnvelope).toContain("untilOccurrenceCount");
  });
});

// ── describe: assign-specific assignedTo format ──────────────────────────────

describe("assign envelope — assignedTo format", () => {
  it("assign envelope formats assignedTo as kind:id (user:id or team:slug)", () => {
    // Verbatim from assign/lib/build-envelope.ts
    expect(assignEnvelope).toContain("`${assigneeKind}:${assigneeId}`");
  });
});

// ── describe: App.tsx error-envelope short-circuit (all three handlers) ────────

describe("error-envelope rendering — all three App.tsx components", () => {
  const resolveApp = readFileSync(
    join(PLUGIN_ROOT, "view-tool/src/apps/resolve/App.tsx"),
    "utf-8",
  );
  const ignoreApp = readFileSync(
    join(PLUGIN_ROOT, "view-tool/src/apps/ignore/App.tsx"),
    "utf-8",
  );
  const assignApp = readFileSync(
    join(PLUGIN_ROOT, "view-tool/src/apps/assign/App.tsx"),
    "utf-8",
  );

  it("resolve App.tsx imports detectErrorEnvelope from @agntux/ui-primitives", () => {
    // Verbatim from view-tool/src/apps/resolve/App.tsx
    expect(resolveApp).toContain("detectErrorEnvelope");
    expect(resolveApp).toContain("@agntux/ui-primitives");
  });

  it("resolve App.tsx short-circuits on detectErrorEnvelope with ServerErrorScreen", () => {
    // Verbatim from view-tool/src/apps/resolve/App.tsx
    expect(resolveApp).toContain("ServerErrorScreen");
  });

  it("ignore App.tsx imports detectErrorEnvelope from @agntux/ui-primitives", () => {
    expect(ignoreApp).toContain("detectErrorEnvelope");
    expect(ignoreApp).toContain("@agntux/ui-primitives");
  });

  it("ignore App.tsx short-circuits on detectErrorEnvelope with ServerErrorScreen", () => {
    expect(ignoreApp).toContain("ServerErrorScreen");
  });

  it("assign App.tsx imports detectErrorEnvelope from @agntux/ui-primitives", () => {
    expect(assignApp).toContain("detectErrorEnvelope");
    expect(assignApp).toContain("@agntux/ui-primitives");
  });

  it("assign App.tsx short-circuits on detectErrorEnvelope with ServerErrorScreen", () => {
    expect(assignApp).toContain("ServerErrorScreen");
  });
});

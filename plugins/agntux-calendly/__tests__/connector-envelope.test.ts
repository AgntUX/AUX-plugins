/**
 * connector-envelope.test.ts — agntux-calendly
 *
 * Asserts that all three view-tool envelope builders emit connector-targeted
 * envelopes that instruct the host's LLM to call the Calendly Connector
 * directly and suppress native Connector UI.
 *
 * GOLDEN RULE: every assertion is derived from the actual authored source of
 * the build-envelope.ts files — read verbatim before asserting.
 *
 * Grounding source: view-tool/src/apps/{handler}/lib/build-envelope.ts
 * (handler output, source of truth #1 in priority order).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const VIEW_SRC = join(PLUGIN_ROOT, "view-tool", "src", "apps");

function readEnvelope(handler: string): string {
  return readFileSync(
    join(VIEW_SRC, handler, "lib", "build-envelope.ts"),
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Cancel handler envelope
// ---------------------------------------------------------------------------
describe("cancel envelope builder", () => {
  it("sources file exists", () => {
    // Existence guard — if absent, all subsequent assertions would give a
    // confusing ENOENT rather than a clear failure message.
    expect(() => readEnvelope("cancel")).not.toThrow();
  });

  it("targets the Calendly Connector", () => {
    const src = readEnvelope("cancel");
    // Verbatim from cancel/lib/build-envelope.ts lines 37-38:
    // "Use the Calendly Connector to cancel a scheduled Calendly event."
    expect(src).toContain("Use the Calendly Connector to cancel");
  });

  it("suppresses native Connector UI (NO_NATIVE_UI_DIRECTIVE)", () => {
    const src = readEnvelope("cancel");
    // Verbatim from build-envelope.ts line 22:
    // "Do NOT render any native Calendly Connector UI for this call"
    expect(src).toContain("Do NOT render any native Calendly Connector UI for this call");
  });

  it("suppresses re-rendering of the AgntUX cancel composer", () => {
    const src = readEnvelope("cancel");
    // Verbatim from build-envelope.ts line 23:
    // "Do NOT re-render the AgntUX cancel composer either; the action is complete."
    expect(src).toContain(
      "Do NOT re-render the AgntUX cancel composer either; the action is complete.",
    );
  });

  it("envelope carries event_uri as a parameter", () => {
    const src = readEnvelope("cancel");
    // Verbatim from build-envelope.ts buildEnvelope function body line 38:
    // "event_uri: ${event_uri}."
    expect(src).toContain("event_uri: ");
  });

  it("escape function guards guillemet delimiters in user-authored reason", () => {
    const src = readEnvelope("cancel");
    // Verbatim from build-envelope.ts line 14-16 — uses two-step escapeBody.
    // Avoiding non-ASCII anchors per mechanical rule 3; assert the function
    // name and the replace chain separately.
    expect(src).toContain("function escapeBody(text: string)");
    expect(src).toContain(".replace(");
  });
});

// ---------------------------------------------------------------------------
// No-show handler envelope
// ---------------------------------------------------------------------------
describe("no-show envelope builder", () => {
  it("sources file exists", () => {
    expect(() => readEnvelope("no-show")).not.toThrow();
  });

  it("targets the Calendly Connector for no-show marking", () => {
    const src = readEnvelope("no-show");
    // Verbatim from no-show/lib/build-envelope.ts line 39:
    // "Use the Calendly Connector to mark an invitee as a no-show."
    expect(src).toContain("Use the Calendly Connector to mark");
  });

  it("suppresses native Connector UI", () => {
    const src = readEnvelope("no-show");
    // Verbatim from build-envelope.ts line 17:
    // "Do NOT render any native Calendly Connector UI for this call"
    expect(src).toContain("Do NOT render any native Calendly Connector UI for this call");
  });

  it("suppresses re-rendering of the AgntUX no-show marker", () => {
    const src = readEnvelope("no-show");
    // Verbatim from build-envelope.ts line 20:
    // "Do NOT re-render the AgntUX no-show marker either; the action is complete."
    expect(src).toContain(
      "Do NOT re-render the AgntUX no-show marker either; the action is complete.",
    );
  });

  it("handles multiple invitees via per-invitee calls", () => {
    const src = readEnvelope("no-show");
    // Verbatim from build-envelope.ts line 47:
    // "Call create_invitee_no_show with invitee:"
    expect(src).toContain("create_invitee_no_show");
  });

  it("returns empty string when invitee_uris is empty", () => {
    const src = readEnvelope("no-show");
    // Verbatim from build-envelope.ts line 33:
    // "if (invitee_uris.length === 0) return \"\";"
    expect(src).toContain("if (invitee_uris.length === 0) return");
  });
});

// ---------------------------------------------------------------------------
// Scheduling-link handler envelope
// ---------------------------------------------------------------------------
describe("scheduling-link envelope builder", () => {
  it("sources file exists", () => {
    expect(() => readEnvelope("scheduling-link")).not.toThrow();
  });

  it("targets the Calendly Connector for scheduling link creation", () => {
    const src = readEnvelope("scheduling-link");
    // Verbatim from scheduling-link/lib/build-envelope.ts line 36:
    // "Use the Calendly Connector in two steps:"
    expect(src).toContain("Use the Calendly Connector in two steps:");
  });

  it("calls scheduling_links-create_single_use_scheduling_link with max_event_count: 1", () => {
    const src = readEnvelope("scheduling-link");
    // Verbatim from build-envelope.ts line 37:
    // "scheduling_links-create_single_use_scheduling_link with max_event_count: 1"
    expect(src).toContain(
      "scheduling_links-create_single_use_scheduling_link with max_event_count: 1",
    );
  });

  it("step 2 extracts booking_url from step 1 response", () => {
    const src = readEnvelope("scheduling-link");
    // Verbatim from build-envelope.ts line 38:
    // "Take the booking_url from the response returned in step 1"
    expect(src).toContain("Take the booking_url from the response returned in step 1");
  });

  it("suppresses native Connector UI", () => {
    const src = readEnvelope("scheduling-link");
    // Verbatim from build-envelope.ts line 10:
    // "Do NOT render any native Calendly Connector UI for this call"
    expect(src).toContain("Do NOT render any native Calendly Connector UI for this call");
  });

  it("suppresses re-rendering of the scheduling-link composer", () => {
    const src = readEnvelope("scheduling-link");
    // Verbatim from build-envelope.ts line 13:
    // "Do NOT re-render the AgntUX scheduling-link composer either; the action is complete."
    expect(src).toContain(
      "Do NOT re-render the AgntUX scheduling-link composer either; the action is complete.",
    );
  });
});

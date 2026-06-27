// build-envelope.test.ts — agntux-docusign (view-tool)
//
// Runtime assertions for the reminder and void envelope builders.
// These are pure functions (no LLM, no ctx dependency) so they can be
// called directly. All expected strings are verbatim from the wire-shape
// comments in the respective build-envelope.ts source files.
//
// Runs under the view-tool vitest config (which provides TypeScript module
// resolution for the .js extension ESM imports in the source).
//
// Non-ASCII guillemet characters (U+00AB «, U+00BB ») are written using
// Unicode escape sequences throughout to avoid any byte-level encoding
// ambiguity that can cause "Expression expected" parse errors in some
// esbuild/Vite configurations.

import { describe, it, expect } from "vitest";
import { buildEnvelope as buildReminderEnvelope } from "../src/apps/reminder/lib/build-envelope.js";
import { buildEnvelope as buildVoidEnvelope } from "../src/apps/void/lib/build-envelope.js";

// U+00AB LEFT-POINTING DOUBLE ANGLE QUOTATION MARK (guillemet open)
const LDAQ = "«";
// U+00BB RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK (guillemet close)
const RDAQ = "»";

// ---------------------------------------------------------------------------
// Reminder buildEnvelope
// ---------------------------------------------------------------------------

describe("reminder buildEnvelope", () => {
  it("without message: uses default reminder messaging phrase", () => {
    const result = buildReminderEnvelope({
      accountId: "acc-001",
      envelopeId: "env-abc",
    });
    // Verbatim from reminder/build-envelope.ts wire shape:
    // "Use sendReminder with default reminder messaging. ({meta})"
    expect(result).toContain("Use sendReminder with default reminder messaging.");
  });

  it("without message: targets DocuSign Connector", () => {
    const result = buildReminderEnvelope({
      accountId: "acc-001",
      envelopeId: "env-abc",
    });
    // Verbatim from reminder/build-envelope.ts:
    // "Use the DocuSign Connector to send a reminder to pending signers."
    expect(result).toContain(
      "Use the DocuSign Connector to send a reminder to pending signers.",
    );
  });

  it("without message: embeds accountId and envelopeId", () => {
    const result = buildReminderEnvelope({
      accountId: "acc-TEST",
      envelopeId: "env-TEST",
    });
    expect(result).toContain("acc-TEST");
    expect(result).toContain("env-TEST");
  });

  it("with message: uses emailBlurb guillemet delimiters", () => {
    const result = buildReminderEnvelope({
      accountId: "acc-001",
      envelopeId: "env-abc",
      message: "Please sign when convenient.",
    });
    // Verbatim from reminder/build-envelope.ts wire shape:
    // "Use sendReminder with emailBlurb: «{message}». ({meta})"
    expect(result).toContain("Use sendReminder with emailBlurb:");
    expect(result).toContain(LDAQ);
    expect(result).toContain(RDAQ);
    expect(result).toContain("Please sign when convenient.");
  });

  it("with whitespace-only message: falls through to default messaging", () => {
    const result = buildReminderEnvelope({
      accountId: "acc-001",
      envelopeId: "env-abc",
      message: "   ",
    });
    expect(result).toContain("Use sendReminder with default reminder messaging.");
  });

  it("escapes guillemet chars in user message", () => {
    const result = buildReminderEnvelope({
      accountId: "acc-001",
      envelopeId: "env-abc",
      message: "Hi " + LDAQ + "Alice" + RDAQ + ".",
    });
    // The escapeBody function replaces « with «« and » with »»
    expect(result).toContain(LDAQ + LDAQ);
    expect(result).toContain(RDAQ + RDAQ);
  });

  it("native-UI suppression directive is always appended", () => {
    const resultDefault = buildReminderEnvelope({
      accountId: "acc-001",
      envelopeId: "env-abc",
    });
    const resultWithMsg = buildReminderEnvelope({
      accountId: "acc-001",
      envelopeId: "env-abc",
      message: "Please review.",
    });
    // Verbatim from reminder/build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Execute the connector tool programmatically and return the result as plain text."
    const directive =
      "Execute the connector tool programmatically and return the result as plain text.";
    expect(resultDefault).toContain(directive);
    expect(resultWithMsg).toContain(directive);
  });

  it("envelope is a non-empty string", () => {
    const result = buildReminderEnvelope({
      accountId: "acc-001",
      envelopeId: "env-abc",
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Void buildEnvelope
// ---------------------------------------------------------------------------

describe("void buildEnvelope", () => {
  it("targets DocuSign Connector to void the envelope", () => {
    const result = buildVoidEnvelope({
      accountId: "acc-001",
      envelopeId: "env-xyz",
      voidedReason: "Terms changed.",
    });
    // Verbatim from void/build-envelope.ts:
    // "Use the DocuSign Connector to void the envelope."
    expect(result).toContain("Use the DocuSign Connector to void the envelope.");
  });

  it("specifies updateEnvelope with envelopeUpdate status voided", () => {
    const result = buildVoidEnvelope({
      accountId: "acc-001",
      envelopeId: "env-xyz",
      voidedReason: "Terms changed.",
    });
    // Verbatim from void/build-envelope.ts wire shape:
    // "Use updateEnvelope with envelopeUpdate status: voided,"
    expect(result).toContain("Use updateEnvelope with envelopeUpdate status: voided,");
  });

  it("embeds voidedReason in guillemet delimiters", () => {
    const result = buildVoidEnvelope({
      accountId: "acc-001",
      envelopeId: "env-xyz",
      voidedReason: "The contract terms have changed.",
    });
    // Verbatim from void/build-envelope.ts wire shape:
    // "voidedReason: «{reason}»."
    expect(result).toContain("voidedReason:");
    expect(result).toContain(LDAQ);
    expect(result).toContain("The contract terms have changed.");
    expect(result).toContain(RDAQ);
  });

  it("includes all recipients notification notice", () => {
    const result = buildVoidEnvelope({
      accountId: "acc-001",
      envelopeId: "env-xyz",
      voidedReason: "Sent in error.",
    });
    // Verbatim from void/build-envelope.ts:
    // "All recipients will be notified with the void reason."
    expect(result).toContain(
      "All recipients will be notified with the void reason.",
    );
  });

  it("embeds accountId and envelopeId", () => {
    const result = buildVoidEnvelope({
      accountId: "acc-TEST",
      envelopeId: "env-TEST",
      voidedReason: "Test.",
    });
    expect(result).toContain("acc-TEST");
    expect(result).toContain("env-TEST");
  });

  it("escapes guillemet chars in voidedReason", () => {
    const result = buildVoidEnvelope({
      accountId: "acc-001",
      envelopeId: "env-xyz",
      voidedReason: "Reason " + LDAQ + "A" + RDAQ + " and " + LDAQ + "B" + RDAQ + ".",
    });
    expect(result).toContain(LDAQ + LDAQ);
    expect(result).toContain(RDAQ + RDAQ);
  });

  it("native-UI suppression directive is always appended", () => {
    const result = buildVoidEnvelope({
      accountId: "acc-001",
      envelopeId: "env-xyz",
      voidedReason: "Sent in error.",
    });
    // Verbatim from void/build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Execute the connector tool programmatically and return the result as plain text."
    expect(result).toContain(
      "Execute the connector tool programmatically and return the result as plain text.",
    );
  });

  it("suppresses DocuSign Connector native MCP App UI", () => {
    const result = buildVoidEnvelope({
      accountId: "acc-001",
      envelopeId: "env-xyz",
      voidedReason: "Sent in error.",
    });
    // Verbatim from void/build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Do NOT render the DocuSign Connector's native MCP App UI for this call"
    expect(result).toContain(
      "Do NOT render the DocuSign Connector's native MCP App UI for this call",
    );
  });

  it("envelope is a non-empty string", () => {
    const result = buildVoidEnvelope({
      accountId: "acc-001",
      envelopeId: "env-xyz",
      voidedReason: "Sent in error.",
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// connector-envelope.test.ts — agntux-docusign
//
// Asserts that the view-tool ships envelope builders that target the DocuSign
// Connector directly (sendReminder and updateEnvelope), and that the sign
// handler correctly ships NO build-envelope.ts (it is open-in / read-only).
//
// All string assertions are verbatim substrings read from the actual
// build-envelope.ts sources — no invented phrases.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

// Paths derived from the actual file tree
const REMINDER_ENVELOPE = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/reminder/lib/build-envelope.ts",
);
const VOID_ENVELOPE = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/void/lib/build-envelope.ts",
);
// sign has NO build-envelope.ts — it is open-in only
const SIGN_ENVELOPE_ABSENT = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/sign/lib/build-envelope.ts",
);

// ---------------------------------------------------------------------------
// File presence / absence
// ---------------------------------------------------------------------------

describe("build-envelope.ts file shape", () => {
  it("reminder build-envelope.ts exists", () => {
    expect(existsSync(REMINDER_ENVELOPE)).toBe(true);
  });

  it("void build-envelope.ts exists", () => {
    expect(existsSync(VOID_ENVELOPE)).toBe(true);
  });

  it("sign does NOT ship a build-envelope.ts (open-in view, no connector write)", () => {
    // Verbatim from sign/components/main-component.tsx:
    // "There is NO Send/commit button and NO connector envelope emitted from this view."
    expect(existsSync(SIGN_ENVELOPE_ABSENT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reminder envelope — connector targeting and native-UI suppression
// ---------------------------------------------------------------------------

describe("reminder build-envelope.ts content", () => {
  const src = readFileSync(REMINDER_ENVELOPE, "utf-8");

  it("targets the sendReminder connector tool", () => {
    // Verbatim from build-envelope.ts: "Use sendReminder"
    expect(src).toContain("Use sendReminder");
  });

  it("targets the DocuSign Connector explicitly", () => {
    // Verbatim from build-envelope.ts: "Use the DocuSign Connector to send a reminder"
    expect(src).toContain("Use the DocuSign Connector to send a reminder");
  });

  it("includes native-UI suppression directive (NO_NATIVE_UI)", () => {
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE constant:
    // "Execute the connector tool programmatically and return the result as plain text."
    expect(src).toContain(
      "Execute the connector tool programmatically and return the result as plain text.",
    );
  });

  it("suppresses DocuSign Connector native UI re-render", () => {
    // Verbatim from build-envelope.ts:
    // "Do NOT render the DocuSign Connector's native MCP App UI for this call"
    expect(src).toContain(
      "Do NOT render the DocuSign Connector's native MCP App UI for this call",
    );
  });

  it("exports buildEnvelope function", () => {
    expect(src).toContain("export function buildEnvelope");
  });

  it("exports ReminderEnvelopeArgs interface", () => {
    // Verbatim from build-envelope.ts: "export interface ReminderEnvelopeArgs"
    expect(src).toContain("export interface ReminderEnvelopeArgs");
  });

  it("includes accountId and envelopeId in envelope args", () => {
    expect(src).toContain("accountId");
    expect(src).toContain("envelopeId");
  });

  it("includes optional emailBlurb / message for custom reminder text", () => {
    // Verbatim from build-envelope.ts: "emailBlurb"
    expect(src).toContain("emailBlurb");
  });

  it("escapes guillemet delimiters in user body content", () => {
    // Verbatim from build-envelope.ts: "function escapeBody"
    expect(src).toContain("function escapeBody");
  });
});

// buildEnvelope runtime tests live in view-tool/__tests__/build-envelope.test.ts
// (where the view-tool's vitest config provides the correct TypeScript module
// resolution). Static-grep assertions above are the plugin-root contract.

// ---------------------------------------------------------------------------
// Void envelope — connector targeting and native-UI suppression
// ---------------------------------------------------------------------------

describe("void build-envelope.ts content", () => {
  const src = readFileSync(VOID_ENVELOPE, "utf-8");

  it("targets the updateEnvelope connector tool", () => {
    // Verbatim from void/build-envelope.ts: "Use updateEnvelope"
    expect(src).toContain("Use updateEnvelope");
  });

  it("targets the DocuSign Connector explicitly", () => {
    // Verbatim from void/build-envelope.ts: "Use the DocuSign Connector to void the envelope."
    expect(src).toContain("Use the DocuSign Connector to void the envelope.");
  });

  it("specifies voided status in the envelope update", () => {
    // Verbatim from void/build-envelope.ts: "envelopeUpdate status: voided"
    expect(src).toContain("envelopeUpdate status: voided");
  });

  it("includes native-UI suppression directive", () => {
    // Verbatim from void/build-envelope.ts:
    // "Execute the connector tool programmatically and return the result as plain text."
    expect(src).toContain(
      "Execute the connector tool programmatically and return the result as plain text.",
    );
  });

  it("exports buildEnvelope function", () => {
    expect(src).toContain("export function buildEnvelope");
  });

  it("exports VoidEnvelopeArgs interface", () => {
    // Verbatim from void/build-envelope.ts: "export interface VoidEnvelopeArgs"
    expect(src).toContain("export interface VoidEnvelopeArgs");
  });

  it("voidedReason is required (not optional)", () => {
    // Verbatim from void/build-envelope.ts: "voidedReason: string;"
    expect(src).toContain("voidedReason: string;");
  });

  it("escapes guillemet delimiters", () => {
    expect(src).toContain("function escapeBody");
  });
});


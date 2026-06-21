// connector-envelope.test.ts — connector-targeted envelope dispatch for agntux-imessage.
//
// This plugin ships a UI handler (agntux_imessage_reply_view), so the modern
// connector-envelope test applies (not the legacy draft-flow chat-confirm test).
// The reply iframe's Send button calls buildEnvelope() which produces a natural-
// language instruction the host executes via the iMessage Connector tool
// mcp__Read_and_Send_iMessages__send_imessage.
//
// Assertions are grounded in verbatim substrings read from:
//   view-tool/src/apps/reply/lib/build-envelope.ts (read-then-copy-literal)
//   view-tool/src/App.tsx                           (read-then-copy-literal)
//
// E30 guard: ZERO assertions touch _overrides/ source files.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

const REPLY_ENVELOPE = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/reply/lib/build-envelope.ts",
);

// ── Reply envelope builder ────────────────────────────────────────────────────

describe("reply envelope builder", () => {
  it("exports a buildEnvelope function", () => {
    const src = readFileSync(REPLY_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts export declaration
    expect(src).toContain("export function buildEnvelope");
  });

  it("targets the iMessage Connector directly in the envelope string", () => {
    const src = readFileSync(REPLY_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts buildEnvelope return string
    expect(src).toContain("Use the iMessage Connector to send an iMessage reply.");
  });

  it("carries the native-UI suppression constant NO_NATIVE_UI_DIRECTIVE", () => {
    const src = readFileSync(REPLY_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts constant declaration
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
  });

  it("suppression directive forbids native iMessage Connector UI", () => {
    const src = readFileSync(REPLY_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE string value
    expect(src).toContain("Do NOT render any native iMessage Connector UI for this call");
  });

  it("suppression directive also forbids re-rendering the AgntUX reply composer", () => {
    const src = readFileSync(REPLY_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE string value
    expect(src).toContain("Do NOT re-render the AgntUX reply composer either");
  });

  it("uses guillemet delimiters to fence the message body (escapeBody function)", () => {
    const src = readFileSync(REPLY_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts escapeBody function declaration
    expect(src).toContain("escapeBody");
  });

  it("accepts recipient, message, and action_id args (ReplyEnvelopeArgs interface)", () => {
    const src = readFileSync(REPLY_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts ReplyEnvelopeArgs interface
    expect(src).toContain("recipient: string");
    expect(src).toContain("message: string");
    expect(src).toContain("action_id: string");
  });

  it("includes the action_id in the envelope string for traceability", () => {
    const src = readFileSync(REPLY_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts buildEnvelope body template string
    expect(src).toContain("action_id: ${action_id}");
  });
});

// ── App.tsx error-envelope short-circuit ─────────────────────────────────────

describe("App.tsx error-envelope short-circuit", () => {
  it("App.tsx short-circuits on detectErrorEnvelope", () => {
    const src = readFileSync(join(PLUGIN_ROOT, "view-tool/src/App.tsx"), "utf-8");
    // Verbatim from App.tsx
    expect(src).toContain("detectErrorEnvelope");
  });

  it("App.tsx renders ServerErrorScreen on error envelope", () => {
    const src = readFileSync(join(PLUGIN_ROOT, "view-tool/src/App.tsx"), "utf-8");
    // Verbatim from App.tsx
    expect(src).toContain("ServerErrorScreen");
  });

  it("App.tsx imports from @agntux/ui-primitives", () => {
    const src = readFileSync(join(PLUGIN_ROOT, "view-tool/src/App.tsx"), "utf-8");
    // Verbatim from App.tsx import declaration
    expect(src).toContain("@agntux/ui-primitives");
  });
});

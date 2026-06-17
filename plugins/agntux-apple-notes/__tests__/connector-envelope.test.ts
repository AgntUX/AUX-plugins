// connector-envelope.test.ts — connector-targeted envelope dispatch for agntux-apple-notes.
//
// Asserts the view-tool's envelope builders:
//   - view-tool/src/apps/create-note/lib/build-envelope.ts
//   - view-tool/src/apps/update-note/lib/build-envelope.ts
//
// Both must target the Apple Notes Connector directly (no intermediate) and
// must carry the native-UI suppression directive to prevent the host stacking
// the connector's own form on top of the AgntUX iframe.
//
// All assertions are grounded in verbatim substrings read from the actual
// builder files (read-then-copy-literal rule).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

const CREATE_ENVELOPE = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/create-note/lib/build-envelope.ts",
);
const UPDATE_ENVELOPE = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/update-note/lib/build-envelope.ts",
);

// ── create-note envelope builder ─────────────────────────────────────────────

describe("create-note envelope builder", () => {
  it("exports a buildEnvelope function", () => {
    const src = readFileSync(CREATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts export declaration
    expect(src).toContain("export function buildEnvelope");
  });

  it("targets the Apple Notes Connector directly", () => {
    const src = readFileSync(CREATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts envelope string
    expect(src).toContain(
      "Use the Apple Notes Connector to create a new Apple Notes note.",
    );
  });

  it("carries native-UI suppression directive", () => {
    const src = readFileSync(CREATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE constant
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
    expect(src).toContain(
      "Do NOT render any of the Apple Notes Connector's own native UI for this call",
    );
  });

  it("references the add_note connector tool", () => {
    const src = readFileSync(CREATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts comment block
    expect(src).toContain("add_note");
  });

  it("uses guillemet delimiters for the body field", () => {
    const src = readFileSync(CREATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts escapeBody function comment
    expect(src).toContain("escapeBody");
  });

  it("accepts name, content, folder, action_id args", () => {
    const src = readFileSync(CREATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts CreateNoteEnvelopeArgs interface
    expect(src).toContain("name: string");
    expect(src).toContain("content: string");
    expect(src).toContain("folder: string");
    expect(src).toContain("action_id: string");
  });
});

// ── update-note envelope builder ─────────────────────────────────────────────

describe("update-note envelope builder", () => {
  it("exports a buildEnvelope function", () => {
    const src = readFileSync(UPDATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts export declaration
    expect(src).toContain("export function buildEnvelope");
  });

  it("targets the Apple Notes Connector directly", () => {
    const src = readFileSync(UPDATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts envelope string
    expect(src).toContain(
      "Use the Apple Notes Connector to update an existing Apple Notes note.",
    );
  });

  it("carries native-UI suppression directive", () => {
    const src = readFileSync(UPDATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE constant
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
    expect(src).toContain(
      "Do NOT render any of the Apple Notes Connector's own native UI for this call",
    );
  });

  it("references the update_note_content connector tool", () => {
    const src = readFileSync(UPDATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts comment block
    expect(src).toContain("update_note_content");
  });

  it("supports checklist and freetext editor modes", () => {
    const src = readFileSync(UPDATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts EditorMode type
    expect(src).toContain('"checklist"');
    expect(src).toContain('"freetext"');
  });

  it("serialises checklist items with - [x] / - [ ] markers", () => {
    const src = readFileSync(UPDATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts serializeChecklist function
    expect(src).toContain("- [x]");
    expect(src).toContain("- [ ]");
  });

  it("accepts note_name, folder, draft_body, checklist_items, action_id args", () => {
    const src = readFileSync(UPDATE_ENVELOPE, "utf-8");
    // Verbatim from build-envelope.ts UpdateNoteEnvelopeArgs interface
    expect(src).toContain("note_name: string");
    expect(src).toContain("folder: string");
    expect(src).toContain("draft_body: string");
    expect(src).toContain("action_id: string");
  });
});

// ── App.tsx error-envelope short-circuit (both handlers) ─────────────────────

describe("App.tsx error-envelope short-circuit", () => {
  it("AppCreateNote.tsx short-circuits on detectErrorEnvelope", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/AppCreateNote.tsx"),
      "utf-8",
    );
    // Verbatim from AppCreateNote.tsx
    expect(src).toContain("detectErrorEnvelope");
    expect(src).toContain("ServerErrorScreen");
    // Verbatim package import from AppCreateNote.tsx
    expect(src).toContain("@agntux/ui-primitives");
  });

  it("AppUpdateNote.tsx short-circuits on detectErrorEnvelope", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/AppUpdateNote.tsx"),
      "utf-8",
    );
    // Verbatim from AppUpdateNote.tsx
    expect(src).toContain("detectErrorEnvelope");
    expect(src).toContain("ServerErrorScreen");
    // Verbatim package import from AppUpdateNote.tsx
    expect(src).toContain("@agntux/ui-primitives");
  });
});

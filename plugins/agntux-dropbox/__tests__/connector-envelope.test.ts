// connector-envelope.test.ts — agntux-dropbox
//
// Asserts that all four view-tool apps ship envelope builders that target the
// Dropbox Connector directly, and that each emits the NO_NATIVE_UI_DIRECTIVE.
//
// Golden rule: every string assertion is a verbatim substring read directly
// from the actual build-envelope.ts source files in view-tool/src/apps/*/lib/.
// No invented phrases.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Envelope builder file paths — derived from the actual tree
// ---------------------------------------------------------------------------

const SHARE_ENVELOPE = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/share/lib/build-envelope.ts",
);
const ORGANIZE_ENVELOPE = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/organize/lib/build-envelope.ts",
);
const NEW_FOLDER_ENVELOPE = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/new-folder/lib/build-envelope.ts",
);
const FILE_REQUEST_ENVELOPE = join(
  PLUGIN_ROOT,
  "view-tool/src/apps/file-request/lib/build-envelope.ts",
);

// ---------------------------------------------------------------------------
// File presence
// ---------------------------------------------------------------------------

describe("build-envelope.ts file presence", () => {
  it("share build-envelope.ts exists", () => {
    expect(existsSync(SHARE_ENVELOPE)).toBe(true);
  });

  it("organize build-envelope.ts exists", () => {
    expect(existsSync(ORGANIZE_ENVELOPE)).toBe(true);
  });

  it("new-folder build-envelope.ts exists", () => {
    expect(existsSync(NEW_FOLDER_ENVELOPE)).toBe(true);
  });

  it("file-request build-envelope.ts exists", () => {
    expect(existsSync(FILE_REQUEST_ENVELOPE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Share envelope — connector targeting and native-UI suppression
// ---------------------------------------------------------------------------

describe("share build-envelope.ts content", () => {
  const src = readFileSync(SHARE_ENVELOPE, "utf-8");

  it("targets the Dropbox Connector explicitly", () => {
    // Verbatim from view-tool/src/apps/share/lib/build-envelope.ts:
    // "Use the Dropbox Connector to create a shareable link for the file."
    expect(src).toContain("Use the Dropbox Connector to create a shareable link");
  });

  it("includes NO_NATIVE_UI_DIRECTIVE constant", () => {
    // Verbatim from build-envelope.ts:
    // const NO_NATIVE_UI_DIRECTIVE =
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
  });

  it("suppresses native Dropbox Connector UI", () => {
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Do NOT render any of the Dropbox Connector's own native UI for this call"
    expect(src).toContain("Do NOT render any of the Dropbox Connector's own native UI for this call");
  });

  it("suppresses AgntUX share compose UI re-render", () => {
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Do NOT re-render the AgntUX share compose UI either; the action is complete."
    expect(src).toContain("Do NOT re-render the AgntUX share compose UI either");
  });

  it("executes the connector tool programmatically (no UI re-render)", () => {
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Execute the connector tool programmatically and return its success or error to chat as plain text."
    expect(src).toContain("Execute the connector tool programmatically");
  });

  it("exports buildEnvelope function", () => {
    // Verbatim from build-envelope.ts: "export function buildEnvelope"
    expect(src).toContain("export function buildEnvelope");
  });

  it("exports ShareEnvelopeArgs interface", () => {
    // Verbatim from build-envelope.ts: "export interface ShareEnvelopeArgs"
    expect(src).toContain("export interface ShareEnvelopeArgs");
  });

  it("includes file_path in ShareEnvelopeArgs", () => {
    // Verbatim from build-envelope.ts: "file_path: string;"
    expect(src).toContain("file_path: string;");
  });

  it("includes file_name in ShareEnvelopeArgs", () => {
    // Verbatim from build-envelope.ts: "file_name: string;"
    expect(src).toContain("file_name: string;");
  });

  it("includes access in ShareEnvelopeArgs", () => {
    // Verbatim from build-envelope.ts: "access: string;"
    expect(src).toContain("access: string;");
  });

  it("includes action_id in ShareEnvelopeArgs", () => {
    // Verbatim from build-envelope.ts: "action_id: string;"
    expect(src).toContain("action_id: string;");
  });

  it("escapes guillemet delimiters in user-authored text", () => {
    // Verbatim from build-envelope.ts: "function escapeField"
    expect(src).toContain("function escapeField");
  });
});

// ---------------------------------------------------------------------------
// Organize envelope — connector targeting and native-UI suppression
// ---------------------------------------------------------------------------

describe("organize build-envelope.ts content", () => {
  const src = readFileSync(ORGANIZE_ENVELOPE, "utf-8");

  it("targets the Dropbox Connector explicitly (move)", () => {
    // Verbatim from view-tool/src/apps/organize/lib/build-envelope.ts:
    // "Use the Dropbox Connector to move the"
    expect(src).toContain("Use the Dropbox Connector to");
  });

  it("references both move and copy connector tools", () => {
    // Verbatim from build-envelope.ts: both verbs appear in the envelope body
    expect(src).toContain("move");
    expect(src).toContain("copy");
  });

  it("includes NO_NATIVE_UI_DIRECTIVE constant", () => {
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
  });

  it("suppresses native Dropbox Connector UI", () => {
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Do NOT render any of the Dropbox Connector's own native UI for this call"
    expect(src).toContain("Do NOT render any of the Dropbox Connector's own native UI for this call");
  });

  it("suppresses AgntUX organize compose UI re-render", () => {
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Do NOT re-render the AgntUX organize compose UI either; the action is complete."
    expect(src).toContain("Do NOT re-render the AgntUX organize compose UI either");
  });

  it("exports buildEnvelope function", () => {
    expect(src).toContain("export function buildEnvelope");
  });

  it("exports OrganizeEnvelopeArgs interface", () => {
    // Verbatim from build-envelope.ts: "export interface OrganizeEnvelopeArgs"
    expect(src).toContain("export interface OrganizeEnvelopeArgs");
  });

  it("includes item_path and destination_path in OrganizeEnvelopeArgs", () => {
    // Verbatim from build-envelope.ts: "item_path: string;" and "destination_path: string;"
    expect(src).toContain("item_path: string;");
    expect(src).toContain("destination_path: string;");
  });

  it("includes mode field (determines move vs copy connector tool)", () => {
    // Verbatim from build-envelope.ts: "mode: string;"
    expect(src).toContain("mode: string;");
  });

  it("escapes guillemet delimiters in user-authored text", () => {
    expect(src).toContain("function escapeField");
  });
});

// ---------------------------------------------------------------------------
// New-folder envelope — connector targeting and native-UI suppression
// ---------------------------------------------------------------------------

describe("new-folder build-envelope.ts content", () => {
  const src = readFileSync(NEW_FOLDER_ENVELOPE, "utf-8");

  it("targets the Dropbox Connector to create a folder", () => {
    // Verbatim from view-tool/src/apps/new-folder/lib/build-envelope.ts:
    // "Use the Dropbox Connector to create a folder."
    expect(src).toContain("Use the Dropbox Connector to create a folder.");
  });

  it("includes NO_NATIVE_UI_DIRECTIVE constant", () => {
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
  });

  it("suppresses native Dropbox Connector UI", () => {
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Do NOT render any of the Dropbox Connector's own native UI for this call"
    expect(src).toContain("Do NOT render any of the Dropbox Connector's own native UI for this call");
  });

  it("suppresses AgntUX new-folder compose UI re-render", () => {
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Do NOT re-render the AgntUX new-folder compose UI either; the action is complete."
    expect(src).toContain("Do NOT re-render the AgntUX new-folder compose UI either");
  });

  it("exports buildEnvelope function", () => {
    expect(src).toContain("export function buildEnvelope");
  });

  it("exports NewFolderEnvelopeArgs interface", () => {
    // Verbatim from build-envelope.ts: "export interface NewFolderEnvelopeArgs"
    expect(src).toContain("export interface NewFolderEnvelopeArgs");
  });

  it("includes parent_path in NewFolderEnvelopeArgs", () => {
    // Verbatim from build-envelope.ts: "parent_path: string;"
    expect(src).toContain("parent_path: string;");
  });

  it("includes folder_name in NewFolderEnvelopeArgs", () => {
    // Verbatim from build-envelope.ts: "folder_name: string;"
    expect(src).toContain("folder_name: string;");
  });

  it("constructs a full path by combining parent_path and folder_name", () => {
    // Verbatim from build-envelope.ts: "const fullPath"
    expect(src).toContain("fullPath");
  });

  it("escapes guillemet delimiters in user-authored text", () => {
    expect(src).toContain("function escapeField");
  });
});

// ---------------------------------------------------------------------------
// File-request envelope — connector targeting and native-UI suppression
// ---------------------------------------------------------------------------

describe("file-request build-envelope.ts content", () => {
  const src = readFileSync(FILE_REQUEST_ENVELOPE, "utf-8");

  it("targets the Dropbox Connector to create a file request", () => {
    // Verbatim from view-tool/src/apps/file-request/lib/build-envelope.ts:
    // "Use the Dropbox Connector to create a file request."
    expect(src).toContain("Use the Dropbox Connector to create a file request.");
  });

  it("includes NO_NATIVE_UI_DIRECTIVE constant", () => {
    expect(src).toContain("NO_NATIVE_UI_DIRECTIVE");
  });

  it("suppresses native Dropbox Connector UI", () => {
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Do NOT render any of the Dropbox Connector's own native UI for this call"
    expect(src).toContain("Do NOT render any of the Dropbox Connector's own native UI for this call");
  });

  it("suppresses AgntUX file-request compose UI re-render", () => {
    // Verbatim from build-envelope.ts NO_NATIVE_UI_DIRECTIVE:
    // "Do NOT re-render the AgntUX file-request compose UI either; the action is complete."
    expect(src).toContain("Do NOT re-render the AgntUX file-request compose UI either");
  });

  it("exports buildEnvelope function", () => {
    expect(src).toContain("export function buildEnvelope");
  });

  it("exports FileRequestEnvelopeArgs interface", () => {
    // Verbatim from build-envelope.ts: "export interface FileRequestEnvelopeArgs"
    expect(src).toContain("export interface FileRequestEnvelopeArgs");
  });

  it("includes destination_path in FileRequestEnvelopeArgs", () => {
    // Verbatim from build-envelope.ts: "destination_path: string;"
    expect(src).toContain("destination_path: string;");
  });

  it("includes title in FileRequestEnvelopeArgs", () => {
    // Verbatim from build-envelope.ts: "title: string;"
    expect(src).toContain("title: string;");
  });

  it("includes optional deadline field in envelope args", () => {
    // Verbatim from build-envelope.ts: "deadline: string;"
    expect(src).toContain("deadline: string;");
  });

  it("omits deadline clause from envelope when deadline is empty", () => {
    // Verbatim from build-envelope.ts:
    // "deadline.trim().length > 0"
    expect(src).toContain("deadline.trim().length > 0");
  });

  it("escapes guillemet delimiters in user-authored text", () => {
    expect(src).toContain("function escapeField");
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: all four envelope builders share the same NO_NATIVE_UI pattern
// ---------------------------------------------------------------------------

describe("NO_NATIVE_UI directive in all four envelope builders", () => {
  const allSources = [
    { name: "share", path: SHARE_ENVELOPE },
    { name: "organize", path: ORGANIZE_ENVELOPE },
    { name: "new-folder", path: NEW_FOLDER_ENVELOPE },
    { name: "file-request", path: FILE_REQUEST_ENVELOPE },
  ];

  for (const { name, path } of allSources) {
    it(`${name}: suppresses connector native UI and AgntUX compose UI re-render`, () => {
      const src = readFileSync(path, "utf-8");
      // Every envelope builder must include the programmatic-execute directive
      // and suppress both the connector's and AgntUX's native UIs.
      expect(src, `${name}: missing Execute directive`).toContain(
        "Execute the connector tool programmatically",
      );
      expect(src, `${name}: missing Dropbox Connector suppression`).toContain(
        "Do NOT render any of the Dropbox Connector's own native UI for this call",
      );
    });
  }
});

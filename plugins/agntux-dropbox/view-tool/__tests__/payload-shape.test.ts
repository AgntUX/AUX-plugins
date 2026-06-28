// payload-shape.test.ts — agntux-dropbox (view-tool)
//
// Canonical byte-budget + frozen-keyset guard for all four view-tool handlers.
//
// Asserts that each handler's structuredContent payload:
//   1. Contains exactly the keys declared in the handler's outputSchema.required.
//   2. Stays within the PAYLOAD_BUDGET_BYTES byte limit (prevents accidental growth).
//   3. Typed fields match their declared JSON-Schema types (all strings).
//   4. Returns a well-formed emptyPayload when action_id is empty or file is missing.
//
// All KEPT_KEYS sets and PAYLOAD_BUDGET_BYTES values are derived from the
// ACTUAL handler source (agntux-dropbox-view.ts outputSchema + emptyPayload
// shapes) — confirmed by reading that file before authoring this test.
//
// Handlers are action_id-driven: they read `actions/{action_id}.md` from the
// personal store, extract the `## Compose payload` fenced YAML block, and lift
// field values. @agntux/plugin-runtime is mocked minimally — only the three
// helpers the handler actually calls: parseFrontmatter, extractFencedYaml,
// renderConfirmationText.

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @agntux/plugin-runtime
//
// The handlers call:
//   parseFrontmatter(text)             → { frontmatter, body }
//   extractFencedYaml(body, "Compose payload") → yaml string or null
//   renderConfirmationText(label)      → label string for content[0].text
//
// We provide minimal pure-function stubs that correctly model the real contract.
// js-yaml is a real dependency in the view-tool — we do NOT mock it.
// ---------------------------------------------------------------------------

vi.mock("@agntux/plugin-runtime", () => {
  /**
   * parseFrontmatter — splits "---\n{yaml}\n---\n{body}" into parts.
   * Returns { frontmatter: {}, body: string }.
   * For the Dropbox handlers, the frontmatter is not read — only `body` is used.
   */
  function parseFrontmatter(text: string): {
    frontmatter: Record<string, unknown>;
    body: string;
  } {
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fmMatch) {
      return { frontmatter: {}, body: text };
    }
    return { frontmatter: {}, body: fmMatch[2] ?? "" };
  }

  /**
   * extractFencedYaml — finds a `## {header}` section in body and returns the
   * raw content of the first ```yaml ... ``` fenced block within it.
   * Returns null when the header or block is absent.
   *
   * Contract from parse-action.d.ts:
   *   extractFencedYaml(body: string, header: string): string | null
   */
  function extractFencedYaml(body: string, header: string): string | null {
    const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Locate the section
    const sectionRe = new RegExp(
      `## ${escapedHeader}[\\s\\S]*?(?=\\n## |$)`,
    );
    const sectionMatch = body.match(sectionRe);
    if (!sectionMatch) return null;
    const section = sectionMatch[0];
    // Extract the fenced yaml block within the section
    const fenceRe = /```yaml\s*([\s\S]*?)```/;
    const fenceMatch = section.match(fenceRe);
    return fenceMatch ? fenceMatch[1].trim() : null;
  }

  function renderConfirmationText(label: string): string {
    return `[${label}]`;
  }

  return { parseFrontmatter, extractFencedYaml, renderConfirmationText };
});

// ---------------------------------------------------------------------------
// Import the view-tool module under test (after mocks are set up)
// ---------------------------------------------------------------------------

import mod from "../src/agntux-dropbox-view.js";

// ---------------------------------------------------------------------------
// Build a minimal ViewToolContext with an in-memory fs
// ---------------------------------------------------------------------------

function makeCtx(files: Record<string, string>) {
  return {
    fs: {
      readFile: async (path: string) => {
        const content = files[path];
        if (content === undefined) {
          throw new Error(`ENOENT: no such file: ${path}`);
        }
        return Buffer.from(content, "utf8");
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture helpers: action files with ## Compose payload fenced YAML blocks
//
// These model the on-disk format the ingest agent writes for each handler.
// Field values are derived from the outputSchema.required arrays in
// agntux-dropbox-view.ts (lines 380-401 share, 438-447 organize, 481-490
// new-folder, 522-530 file-request).
// ---------------------------------------------------------------------------

const SHARE_ACTION_MD = `---
id: action-share-001
status: open
---
## Why this matters

The file needs to be shared with the client team.

## Compose payload

\`\`\`yaml
file_path: /Work Projects/Q3 Report.docx
file_name: Q3 Report.docx
file_type: document
existing_link: ""
suggested_access: anyone
suggested_expiry: "2026-07-31"
source_context: Updated by Jane on 2026-06-25
\`\`\`
`;

const ORGANIZE_ACTION_MD = `---
id: action-organize-001
status: open
---
## Why this matters

The file should be moved to the archive folder.

## Compose payload

\`\`\`yaml
item_path: /Work Projects/Old Brief.docx
item_name: Old Brief.docx
item_type: document
suggested_destination: /Archive/2026/Q2
mode: move
source_context: Last modified 2026-03-15
\`\`\`
`;

const NEW_FOLDER_ACTION_MD = `---
id: action-new-folder-001
status: open
---
## Why this matters

A new project folder is needed.

## Compose payload

\`\`\`yaml
parent_path: /Work Projects
parent_name: Work Projects
suggested_folder_name: Acme Campaign 2026
source_context: Discussed in meeting on 2026-06-24
\`\`\`
`;

const FILE_REQUEST_ACTION_MD = `---
id: action-file-request-001
status: open
---
## Why this matters

Collecting design assets from the external agency.

## Compose payload

\`\`\`yaml
destination_path: /Design Assets/Incoming
destination_name: Incoming
suggested_title: Agency Design Assets for Q3
suggested_deadline: "2026-07-15"
source_context: Mentioned in Slack on 2026-06-25
\`\`\`
`;

// ---------------------------------------------------------------------------
// Locate handlers by tool name (from agntux-dropbox-view.ts viewTools array)
// ---------------------------------------------------------------------------

const shareTool = mod.viewTools.find(
  (t) => t.descriptor.name === "agntux_dropbox_share",
)!;
const organizeTool = mod.viewTools.find(
  (t) => t.descriptor.name === "agntux_dropbox_organize",
)!;
const newFolderTool = mod.viewTools.find(
  (t) => t.descriptor.name === "agntux_dropbox_new_folder",
)!;
const fileRequestTool = mod.viewTools.find(
  (t) => t.descriptor.name === "agntux_dropbox_file_request",
)!;

// ---------------------------------------------------------------------------
// Payload budgets — derived from handler emptyPayload field counts + typical
// fixture content. All four handlers return small string-only scalar objects.
// Budget: 8 string fields × ~80 bytes average + overhead = well under 1 KB.
// Use 2 KB as a generous ceiling that still catches accidental array/blob growth.
// ---------------------------------------------------------------------------

const SHARE_PAYLOAD_BUDGET_BYTES = 2048;
const ORGANIZE_PAYLOAD_BUDGET_BYTES = 2048;
const NEW_FOLDER_PAYLOAD_BUDGET_BYTES = 2048;
const FILE_REQUEST_PAYLOAD_BUDGET_BYTES = 2048;

// ---------------------------------------------------------------------------
// Frozen keysets — exactly the outputSchema.required keys for each handler.
// Derived verbatim from agntux-dropbox-view.ts outputSchema.required arrays.
// ---------------------------------------------------------------------------

// share: lines 392-401 in agntux-dropbox-view.ts
const SHARE_KEPT_KEYS = new Set([
  "action_id",
  "source_context",
  "file_path",
  "file_name",
  "file_type",
  "existing_link",
  "suggested_access",
  "suggested_expiry",
]);

// organize: lines 438-447 in agntux-dropbox-view.ts
const ORGANIZE_KEPT_KEYS = new Set([
  "action_id",
  "source_context",
  "item_path",
  "item_name",
  "item_type",
  "suggested_destination",
  "mode",
]);

// new-folder: lines 481-490 in agntux-dropbox-view.ts
const NEW_FOLDER_KEPT_KEYS = new Set([
  "action_id",
  "source_context",
  "parent_path",
  "parent_name",
  "suggested_folder_name",
]);

// file-request: lines 522-530 in agntux-dropbox-view.ts
const FILE_REQUEST_KEPT_KEYS = new Set([
  "action_id",
  "source_context",
  "destination_path",
  "destination_name",
  "suggested_title",
  "suggested_deadline",
]);

// ---------------------------------------------------------------------------
// Helper: assert payload keyset and budget
// ---------------------------------------------------------------------------

function assertPayloadShape(
  payload: Record<string, unknown>,
  keptKeys: Set<string>,
  budgetBytes: number,
  label: string,
) {
  const actualKeys = new Set(Object.keys(payload));

  // Frozen keyset: no extra keys, no missing keys
  for (const key of keptKeys) {
    expect(actualKeys.has(key), `${label}: missing key "${key}"`).toBe(true);
  }
  for (const key of actualKeys) {
    expect(keptKeys.has(key), `${label}: unexpected key "${key}"`).toBe(true);
  }

  // Byte budget
  const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
  expect(
    size,
    `${label}: payload exceeds ${budgetBytes} bytes (got ${size})`,
  ).toBeLessThanOrEqual(budgetBytes);
}

// ---------------------------------------------------------------------------
// Tests: share handler (agntux_dropbox_share)
// ---------------------------------------------------------------------------

describe("agntux_dropbox_share handler", () => {
  it("returns exact keyset from outputSchema.required when action file is found", async () => {
    const ctx = makeCtx({ "actions/action-share-001.md": SHARE_ACTION_MD });
    const result = await shareTool.handle(
      { action_id: "action-share-001" },
      ctx as never,
    );
    const payload = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      payload,
      SHARE_KEPT_KEYS,
      SHARE_PAYLOAD_BUDGET_BYTES,
      "share",
    );
  });

  it("populates file_path, file_name, file_type from Compose payload YAML", async () => {
    const ctx = makeCtx({ "actions/action-share-001.md": SHARE_ACTION_MD });
    const result = await shareTool.handle(
      { action_id: "action-share-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.file_path).toBe("/Work Projects/Q3 Report.docx");
    expect(p.file_name).toBe("Q3 Report.docx");
    expect(p.file_type).toBe("document");
  });

  it("populates suggested_access and suggested_expiry from Compose payload YAML", async () => {
    const ctx = makeCtx({ "actions/action-share-001.md": SHARE_ACTION_MD });
    const result = await shareTool.handle(
      { action_id: "action-share-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.suggested_access).toBe("anyone");
    expect(p.suggested_expiry).toBe("2026-07-31");
  });

  it("populates source_context from Compose payload YAML", async () => {
    const ctx = makeCtx({ "actions/action-share-001.md": SHARE_ACTION_MD });
    const result = await shareTool.handle(
      { action_id: "action-share-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.source_context).toBe("Updated by Jane on 2026-06-25");
  });

  it("all payload values are strings", async () => {
    const ctx = makeCtx({ "actions/action-share-001.md": SHARE_ACTION_MD });
    const result = await shareTool.handle(
      { action_id: "action-share-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    for (const key of SHARE_KEPT_KEYS) {
      expect(typeof p[key], `share.${key} should be string`).toBe("string");
    }
  });

  it("returns emptyPayload (action_id=actionId, all fields empty) when action file is missing", async () => {
    const ctx = makeCtx({});
    const result = await shareTool.handle(
      { action_id: "missing-action" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      p,
      SHARE_KEPT_KEYS,
      SHARE_PAYLOAD_BUDGET_BYTES,
      "share-missing",
    );
    expect(p.action_id).toBe("missing-action");
    expect(p.file_path).toBe("");
    expect(p.file_name).toBe("");
  });

  it("returns emptyPayload with suggested_access defaulting to 'anyone' when action_id is empty string", async () => {
    const ctx = makeCtx({});
    const result = await shareTool.handle({ action_id: "" }, ctx as never);
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      p,
      SHARE_KEPT_KEYS,
      SHARE_PAYLOAD_BUDGET_BYTES,
      "share-empty-id",
    );
    // Verbatim from agntux-dropbox-view.ts emptyPayload: suggested_access: "anyone"
    expect(p.suggested_access).toBe("anyone");
    expect(p.action_id).toBe("");
  });

  it("content[0].type is 'text'", async () => {
    const ctx = makeCtx({ "actions/action-share-001.md": SHARE_ACTION_MD });
    const result = await shareTool.handle(
      { action_id: "action-share-001" },
      ctx as never,
    );
    expect(result.content[0].type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Tests: organize handler (agntux_dropbox_organize)
// ---------------------------------------------------------------------------

describe("agntux_dropbox_organize handler", () => {
  it("returns exact keyset from outputSchema.required when action file is found", async () => {
    const ctx = makeCtx({
      "actions/action-organize-001.md": ORGANIZE_ACTION_MD,
    });
    const result = await organizeTool.handle(
      { action_id: "action-organize-001" },
      ctx as never,
    );
    const payload = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      payload,
      ORGANIZE_KEPT_KEYS,
      ORGANIZE_PAYLOAD_BUDGET_BYTES,
      "organize",
    );
  });

  it("populates item_path, item_name, item_type from Compose payload YAML", async () => {
    const ctx = makeCtx({
      "actions/action-organize-001.md": ORGANIZE_ACTION_MD,
    });
    const result = await organizeTool.handle(
      { action_id: "action-organize-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.item_path).toBe("/Work Projects/Old Brief.docx");
    expect(p.item_name).toBe("Old Brief.docx");
    expect(p.item_type).toBe("document");
  });

  it("populates suggested_destination and mode from Compose payload YAML", async () => {
    const ctx = makeCtx({
      "actions/action-organize-001.md": ORGANIZE_ACTION_MD,
    });
    const result = await organizeTool.handle(
      { action_id: "action-organize-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.suggested_destination).toBe("/Archive/2026/Q2");
    expect(p.mode).toBe("move");
  });

  it("all payload values are strings", async () => {
    const ctx = makeCtx({
      "actions/action-organize-001.md": ORGANIZE_ACTION_MD,
    });
    const result = await organizeTool.handle(
      { action_id: "action-organize-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    for (const key of ORGANIZE_KEPT_KEYS) {
      expect(typeof p[key], `organize.${key} should be string`).toBe("string");
    }
  });

  it("returns emptyPayload when action file is missing", async () => {
    const ctx = makeCtx({});
    const result = await organizeTool.handle(
      { action_id: "nonexistent" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      p,
      ORGANIZE_KEPT_KEYS,
      ORGANIZE_PAYLOAD_BUDGET_BYTES,
      "organize-missing",
    );
    expect(p.action_id).toBe("nonexistent");
    expect(p.item_path).toBe("");
  });

  it("returns emptyPayload with mode defaulting to 'move' when action_id is empty string", async () => {
    const ctx = makeCtx({});
    const result = await organizeTool.handle({ action_id: "" }, ctx as never);
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      p,
      ORGANIZE_KEPT_KEYS,
      ORGANIZE_PAYLOAD_BUDGET_BYTES,
      "organize-empty-id",
    );
    // Verbatim from agntux-dropbox-view.ts emptyPayload: mode: "move"
    expect(p.mode).toBe("move");
    expect(p.action_id).toBe("");
  });

  it("content[0].type is 'text'", async () => {
    const ctx = makeCtx({
      "actions/action-organize-001.md": ORGANIZE_ACTION_MD,
    });
    const result = await organizeTool.handle(
      { action_id: "action-organize-001" },
      ctx as never,
    );
    expect(result.content[0].type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Tests: new-folder handler (agntux_dropbox_new_folder)
// ---------------------------------------------------------------------------

describe("agntux_dropbox_new_folder handler", () => {
  it("returns exact keyset from outputSchema.required when action file is found", async () => {
    const ctx = makeCtx({
      "actions/action-new-folder-001.md": NEW_FOLDER_ACTION_MD,
    });
    const result = await newFolderTool.handle(
      { action_id: "action-new-folder-001" },
      ctx as never,
    );
    const payload = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      payload,
      NEW_FOLDER_KEPT_KEYS,
      NEW_FOLDER_PAYLOAD_BUDGET_BYTES,
      "new-folder",
    );
  });

  it("populates parent_path and parent_name from Compose payload YAML", async () => {
    const ctx = makeCtx({
      "actions/action-new-folder-001.md": NEW_FOLDER_ACTION_MD,
    });
    const result = await newFolderTool.handle(
      { action_id: "action-new-folder-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.parent_path).toBe("/Work Projects");
    expect(p.parent_name).toBe("Work Projects");
  });

  it("populates suggested_folder_name from Compose payload YAML", async () => {
    const ctx = makeCtx({
      "actions/action-new-folder-001.md": NEW_FOLDER_ACTION_MD,
    });
    const result = await newFolderTool.handle(
      { action_id: "action-new-folder-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.suggested_folder_name).toBe("Acme Campaign 2026");
  });

  it("populates source_context from Compose payload YAML", async () => {
    const ctx = makeCtx({
      "actions/action-new-folder-001.md": NEW_FOLDER_ACTION_MD,
    });
    const result = await newFolderTool.handle(
      { action_id: "action-new-folder-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.source_context).toBe("Discussed in meeting on 2026-06-24");
  });

  it("all payload values are strings", async () => {
    const ctx = makeCtx({
      "actions/action-new-folder-001.md": NEW_FOLDER_ACTION_MD,
    });
    const result = await newFolderTool.handle(
      { action_id: "action-new-folder-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    for (const key of NEW_FOLDER_KEPT_KEYS) {
      expect(typeof p[key], `new-folder.${key} should be string`).toBe(
        "string",
      );
    }
  });

  it("returns emptyPayload when action file is missing", async () => {
    const ctx = makeCtx({});
    const result = await newFolderTool.handle(
      { action_id: "missing-folder-action" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      p,
      NEW_FOLDER_KEPT_KEYS,
      NEW_FOLDER_PAYLOAD_BUDGET_BYTES,
      "new-folder-missing",
    );
    expect(p.action_id).toBe("missing-folder-action");
    expect(p.parent_path).toBe("");
    expect(p.suggested_folder_name).toBe("");
  });

  it("returns emptyPayload when action_id is empty string", async () => {
    const ctx = makeCtx({});
    const result = await newFolderTool.handle(
      { action_id: "" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      p,
      NEW_FOLDER_KEPT_KEYS,
      NEW_FOLDER_PAYLOAD_BUDGET_BYTES,
      "new-folder-empty-id",
    );
    expect(p.action_id).toBe("");
    expect(p.parent_name).toBe("");
  });

  it("content[0].type is 'text'", async () => {
    const ctx = makeCtx({
      "actions/action-new-folder-001.md": NEW_FOLDER_ACTION_MD,
    });
    const result = await newFolderTool.handle(
      { action_id: "action-new-folder-001" },
      ctx as never,
    );
    expect(result.content[0].type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Tests: file-request handler (agntux_dropbox_file_request)
// ---------------------------------------------------------------------------

describe("agntux_dropbox_file_request handler", () => {
  it("returns exact keyset from outputSchema.required when action file is found", async () => {
    const ctx = makeCtx({
      "actions/action-file-request-001.md": FILE_REQUEST_ACTION_MD,
    });
    const result = await fileRequestTool.handle(
      { action_id: "action-file-request-001" },
      ctx as never,
    );
    const payload = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      payload,
      FILE_REQUEST_KEPT_KEYS,
      FILE_REQUEST_PAYLOAD_BUDGET_BYTES,
      "file-request",
    );
  });

  it("populates destination_path and destination_name from Compose payload YAML", async () => {
    const ctx = makeCtx({
      "actions/action-file-request-001.md": FILE_REQUEST_ACTION_MD,
    });
    const result = await fileRequestTool.handle(
      { action_id: "action-file-request-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.destination_path).toBe("/Design Assets/Incoming");
    expect(p.destination_name).toBe("Incoming");
  });

  it("populates suggested_title and suggested_deadline from Compose payload YAML", async () => {
    const ctx = makeCtx({
      "actions/action-file-request-001.md": FILE_REQUEST_ACTION_MD,
    });
    const result = await fileRequestTool.handle(
      { action_id: "action-file-request-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.suggested_title).toBe("Agency Design Assets for Q3");
    expect(p.suggested_deadline).toBe("2026-07-15");
  });

  it("populates source_context from Compose payload YAML", async () => {
    const ctx = makeCtx({
      "actions/action-file-request-001.md": FILE_REQUEST_ACTION_MD,
    });
    const result = await fileRequestTool.handle(
      { action_id: "action-file-request-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    expect(p.source_context).toBe("Mentioned in Slack on 2026-06-25");
  });

  it("all payload values are strings", async () => {
    const ctx = makeCtx({
      "actions/action-file-request-001.md": FILE_REQUEST_ACTION_MD,
    });
    const result = await fileRequestTool.handle(
      { action_id: "action-file-request-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    for (const key of FILE_REQUEST_KEPT_KEYS) {
      expect(typeof p[key], `file-request.${key} should be string`).toBe(
        "string",
      );
    }
  });

  it("returns emptyPayload when action file is missing", async () => {
    const ctx = makeCtx({});
    const result = await fileRequestTool.handle(
      { action_id: "missing-request-action" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      p,
      FILE_REQUEST_KEPT_KEYS,
      FILE_REQUEST_PAYLOAD_BUDGET_BYTES,
      "file-request-missing",
    );
    expect(p.action_id).toBe("missing-request-action");
    expect(p.suggested_title).toBe("");
    expect(p.suggested_deadline).toBe("");
  });

  it("returns emptyPayload when action_id is empty string", async () => {
    const ctx = makeCtx({});
    const result = await fileRequestTool.handle(
      { action_id: "" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    assertPayloadShape(
      p,
      FILE_REQUEST_KEPT_KEYS,
      FILE_REQUEST_PAYLOAD_BUDGET_BYTES,
      "file-request-empty-id",
    );
    expect(p.action_id).toBe("");
    expect(p.destination_path).toBe("");
  });

  it("content[0].type is 'text'", async () => {
    const ctx = makeCtx({
      "actions/action-file-request-001.md": FILE_REQUEST_ACTION_MD,
    });
    const result = await fileRequestTool.handle(
      { action_id: "action-file-request-001" },
      ctx as never,
    );
    expect(result.content[0].type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Namespaced-header regression — Compose payload (dropbox)
//
// Proves that the share handler's namespaced-first read:
//   extractFencedYaml(body, "Compose payload (dropbox)") ?? extractFencedYaml(body, "Compose payload")
// surfaces the values from the ## Compose payload (dropbox) section when
// an action file carries BOTH sections (cross-source merge scenario),
// not the values from the bare ## Compose payload decoy.
//
// Ordering: bare (decoy) section appears FIRST in the fixture so the
// extractFencedYaml("Compose payload") call would return decoy values if
// the namespaced lookup were skipped — making the assertion load-bearing.
// ---------------------------------------------------------------------------

const SHARE_CROSS_SOURCE_ACTION_MD = `---
id: action-share-xsrc-001
status: open
---
## Why this matters

Cross-source merged action file — carries both a bare and a namespaced compose payload.

## Compose payload

\`\`\`yaml
file_path: /Decoy/ShouldNotUse.docx
file_name: ShouldNotUse.docx
file_type: image
existing_link: "https://decoy.example.com"
suggested_access: team
suggested_expiry: "2025-01-01"
source_context: Decoy bare-header sentinel
\`\`\`

## Compose payload (dropbox)

\`\`\`yaml
file_path: /Real/NamespacedFile.docx
file_name: NamespacedFile.docx
file_type: document
existing_link: ""
suggested_access: anyone
suggested_expiry: "2026-08-15"
source_context: Namespaced sentinel value
\`\`\`
`;

describe("namespaced-header regression — Compose payload (dropbox)", () => {
  it("share handler reads ## Compose payload (dropbox) over bare ## Compose payload decoy", async () => {
    const ctx = makeCtx({
      "actions/action-share-xsrc-001.md": SHARE_CROSS_SOURCE_ACTION_MD,
    });
    const result = await shareTool.handle(
      { action_id: "action-share-xsrc-001" },
      ctx as never,
    );
    const p = result.structuredContent as Record<string, unknown>;
    // Namespaced section values must appear in structuredContent
    expect(p.file_path).toBe("/Real/NamespacedFile.docx");
    expect(p.file_name).toBe("NamespacedFile.docx");
    expect(p.file_type).toBe("document");
    expect(p.source_context).toBe("Namespaced sentinel value");
    // Decoy bare-header values must NOT appear
    expect(p.file_path).not.toBe("/Decoy/ShouldNotUse.docx");
    expect(p.source_context).not.toBe("Decoy bare-header sentinel");
  });
});

// ---------------------------------------------------------------------------
// Module shape — four tools exported, correct resource URIs
// ---------------------------------------------------------------------------

describe("view-tool module shape", () => {
  it("exports exactly four viewTools", () => {
    // Verbatim from agntux-dropbox-view.ts:
    // viewTools: [shareViewTool, organizeViewTool, newFolderViewTool, fileRequestViewTool]
    expect(mod.viewTools).toHaveLength(4);
  });

  it("share tool ui_resource_uri matches SHARE_RESOURCE_URI constant", () => {
    // Verbatim from agntux-dropbox-view.ts: "ui://agntux-dropbox/share-file"
    expect(shareTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-dropbox/share-file",
    );
  });

  it("organize tool ui_resource_uri matches ORGANIZE_RESOURCE_URI constant", () => {
    // Verbatim from agntux-dropbox-view.ts: "ui://agntux-dropbox/organize-file"
    expect(organizeTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-dropbox/organize-file",
    );
  });

  it("new-folder tool ui_resource_uri matches NEW_FOLDER_RESOURCE_URI constant", () => {
    // Verbatim from agntux-dropbox-view.ts: "ui://agntux-dropbox/new-folder"
    expect(newFolderTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-dropbox/new-folder",
    );
  });

  it("file-request tool ui_resource_uri matches FILE_REQUEST_RESOURCE_URI constant", () => {
    // Verbatim from agntux-dropbox-view.ts: "ui://agntux-dropbox/file-request"
    expect(fileRequestTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-dropbox/file-request",
    );
  });

  it("all four tools have data_paths scoped to personal", () => {
    for (const tool of mod.viewTools) {
      // Verbatim from agntux-dropbox-view.ts:
      // data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
      expect(tool.descriptor.data_paths?.[0]?.scope).toBe("personal");
      expect(tool.descriptor.data_paths?.[0]?.pattern).toBe("actions/{id}.md");
    }
  });

  it("all four tools have action_id as required inputSchema property", () => {
    for (const tool of mod.viewTools) {
      const schema = tool.descriptor.inputSchema;
      expect((schema as Record<string, unknown>).required).toContain(
        "action_id",
      );
    }
  });

  it("tool names match the expected agntux_dropbox_* pattern", () => {
    const names = mod.viewTools.map((t) => t.descriptor.name);
    expect(names).toContain("agntux_dropbox_share");
    expect(names).toContain("agntux_dropbox_organize");
    expect(names).toContain("agntux_dropbox_new_folder");
    expect(names).toContain("agntux_dropbox_file_request");
  });
});

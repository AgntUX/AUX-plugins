// =============================================================================
// payload-shape.test.ts — payload-shape regression guard for agntux-apple-notes.
//
// Tests BOTH view tools in the single module:
//   mod.viewTools[0] = agntux_apple_notes_create_note
//   mod.viewTools[1] = agntux_apple_notes_update_note
//
// Assertions are grounded in handler OUTPUT (Golden Rule #1) — the real
// structuredContent keys / byte size from calling viewTool.handle() with
// in-memory fixtures. NEVER grep prose from fetch.md / sync.md / _overrides.
//
// KEPT_KEYS are derived from the handler's interface definitions and the
// task brief's structuredContent key lists. PAYLOAD_BUDGET_BYTES = 30 KB
// (single-row compose views; the heaviest field is draft_body / current_content).
//
// Pass 11 (E24/E25) of the marketplace linter verifies this file exists and
// contains a Buffer.byteLength/JSON.stringify byte-size assertion paired with
// a toBeLessThan matcher. Both conditions are met here.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
  ViewToolScope,
} from "@agntux/plugin-runtime";
import { ViewToolFsError } from "@agntux/plugin-runtime";
import mod from "../src/agntux-apple-notes-view.js";

// ── Tunable knobs ─────────────────────────────────────────────────────────────

/**
 * Single-row compose view — 30 KB is a defensible upper bound even when
 * draft_body / current_content is filled with a long note.
 */
const PAYLOAD_BUDGET_BYTES = 30 * 1024;

/**
 * create-note structuredContent keys (grounded in CreateNotePayload interface):
 *   action_id, source_context, draft_title, draft_body, target_folder, available_folders
 */
const CREATE_KEPT_KEYS = new Set([
  "action_id",
  "source_context",
  "draft_title",
  "draft_body",
  "target_folder",
  "available_folders",
]);

/**
 * update-note structuredContent keys (grounded in UpdateNotePayload interface):
 *   action_id, source_context, note_name, note_id, folder, current_content,
 *   draft_body, is_checklist, checklist_items
 */
const UPDATE_KEPT_KEYS = new Set([
  "action_id",
  "source_context",
  "note_name",
  "note_id",
  "folder",
  "current_content",
  "draft_body",
  "is_checklist",
  "checklist_items",
]);

// ── In-memory fs ─────────────────────────────────────────────────────────────

function inMemoryFs(files: Record<string, string>): ViewToolFs {
  return {
    async readFile(path: string) {
      const content = files[path];
      if (content == null) throw new ViewToolFsError("not-found", path);
      return Buffer.from(content, "utf8");
    },
    async readMany(paths: string[]) {
      return paths.map((p) => {
        const c = files[p];
        return c != null ? Buffer.from(c, "utf8") : null;
      });
    },
    async list(prefix: string) {
      return Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .sort();
    },
    async listWithMeta(prefix: string): Promise<ListWithMetaEntry[]> {
      return Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((path) => ({ path, meta: null }));
    },
    async exists(path: string) {
      return Object.prototype.hasOwnProperty.call(files, path);
    },
  };
}

// ── Context factory ───────────────────────────────────────────────────────────

const FIXED_SCOPE: ViewToolScope = {
  user_id: "test-user",
  organization_id: "test-org",
};

function makeCtx(files: Record<string, string>, now?: Date): ViewToolContext {
  const fixedNow = now ?? new Date("2026-01-01T00:00:00Z");
  const ctx: ViewToolContext = {
    fs: inMemoryFs(files),
    scope: FIXED_SCOPE,
    now: () => fixedNow,
    log: () => undefined,
    withScope: () => makeCtx(files, fixedNow),
  };
  return ctx;
}

// ── Action-file builders ──────────────────────────────────────────────────────

/**
 * Build a create-note action file. The handler reads `## Compose payload`
 * body section as fenced YAML; fields there feed the structuredContent.
 */
function makeCreateNoteActionFile(opts: {
  id: string;
  source_context?: string;
  draft_title?: string;
  draft_body?: string;
  target_folder?: string;
  available_folders?: string[];
}): string {
  const fm = [`id: ${opts.id}`, `type: action`].join("\n");
  const composePayloadYaml = [
    `source_context: "${opts.source_context ?? "Meeting notes from June 15"}"`,
    `draft_title: "${opts.draft_title ?? "Test Note"}"`,
    `draft_body: "${opts.draft_body ?? "This is the note body."}"`,
    `target_folder: "${opts.target_folder ?? "Personal"}"`,
    `available_folders:`,
    ...(opts.available_folders ?? ["Personal", "Work"]).map(
      (f) => `  - "${f}"`,
    ),
  ].join("\n");

  return (
    `---\n${fm}\n---\n\n` +
    `## Compose payload\n\n` +
    "```yaml\n" +
    `${composePayloadYaml}\n` +
    "```\n"
  );
}

/**
 * Build an update-note action file. The handler reads `## Compose payload`
 * body section as fenced YAML.
 */
function makeUpdateNoteActionFile(opts: {
  id: string;
  source_context?: string;
  note_name?: string;
  note_id?: string;
  folder?: string;
  current_content?: string;
  draft_body?: string;
  is_checklist?: boolean;
}): string {
  const fm = [`id: ${opts.id}`, `type: action`].join("\n");
  const isChecklist = opts.is_checklist ?? false;
  const composePayloadYaml = [
    `source_context: "${opts.source_context ?? "Grocery list"}"`,
    `note_name: "${opts.note_name ?? "Shopping List"}"`,
    `note_id: "x-coredata://test-store/ICNote/p42"`,
    `folder: "${opts.folder ?? "Personal"}"`,
    `current_content: "${opts.current_content ?? "- [ ] Milk\\n- [x] Eggs"}"`,
    `draft_body: "${opts.draft_body ?? "- [ ] Milk\\n- [x] Eggs\\n- [ ] Butter"}"`,
    `is_checklist: ${isChecklist}`,
    `checklist_items:`,
    isChecklist
      ? `  - text: "Milk"\n    checked: false\n  - text: "Eggs"\n    checked: true`
      : ``,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return (
    `---\n${fm}\n---\n\n` +
    `## Compose payload\n\n` +
    "```yaml\n" +
    `${composePayloadYaml}\n` +
    "```\n"
  );
}

// ── View tools under test ─────────────────────────────────────────────────────

const createNoteViewTool = mod.viewTools[0]!;
const updateNoteViewTool = mod.viewTools[1]!;

// =============================================================================
// CREATE-NOTE
// =============================================================================

describe("agntux_apple_notes_create_note payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const heavyTitle = "T".repeat(2000); // exercise long-string path
    const heavyBody = "B".repeat(8000);  // exercise heavy note body
    const files = {
      "actions/create-1.md": makeCreateNoteActionFile({
        id: "create-1",
        draft_title: heavyTitle,
        draft_body: heavyBody,
        available_folders: Array.from({ length: 20 }, (_, i) => `Folder${i}`),
      }),
    };
    const result = await createNoteViewTool.handle(
      { action_id: "create-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    // Sanity: heavy draft_title was forwarded (proves the payload is non-trivial)
    expect((sc as Record<string, unknown>).draft_title).toBe(heavyTitle);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/create-k1.md": makeCreateNoteActionFile({ id: "create-k1" }),
    };
    const result = await createNoteViewTool.handle(
      { action_id: "create-k1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(
        CREATE_KEPT_KEYS.has(k),
        `unexpected key "${k}" in create-note structuredContent`,
      ).toBe(true);
    }
    for (const k of CREATE_KEPT_KEYS) {
      expect(
        keys.has(k),
        `missing required key "${k}" in create-note structuredContent`,
      ).toBe(true);
    }
  });

  it("returns sensible field values from the compose payload section", async () => {
    const files = {
      "actions/create-v1.md": makeCreateNoteActionFile({
        id: "create-v1",
        draft_title: "My Note",
        draft_body: "Hello world",
        target_folder: "Work",
        available_folders: ["Work", "Personal"],
        source_context: "From meeting on June 16",
      }),
    };
    const result = await createNoteViewTool.handle(
      { action_id: "create-v1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("create-v1");
    expect(sc.draft_title).toBe("My Note");
    expect(sc.draft_body).toBe("Hello world");
    expect(sc.target_folder).toBe("Work");
    expect(Array.isArray(sc.available_folders)).toBe(true);
    expect((sc.available_folders as string[]).length).toBeGreaterThan(0);
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await createNoteViewTool.handle(
      { action_id: "does-not-exist" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("reads the namespaced ## Compose payload (apple-notes) section over a sibling's bare ## Compose payload (cross-source merge)", async () => {
    const NAMESPACED_TITLE = "Apple Notes Note Title";
    const DECOY_TITLE = "DECOY_TITLE_DO_NOT_USE";
    // Build a cross-source-merged action file: the namespaced section carries
    // the real draft fields; the bare section simulates a sibling plugin's
    // reply draft. The view must prefer the namespaced header.
    const actionFile =
      `---\nid: cross-src-1\ntype: action\n---\n\n` +
      `## Compose payload (apple-notes)\n\n` +
      "```yaml\n" +
      `source_context: "Meeting that produced this note"\n` +
      `draft_title: "${NAMESPACED_TITLE}"\n` +
      `draft_body: "Body from the namespaced section"\n` +
      `target_folder: "Work"\n` +
      `available_folders:\n  - "Work"\n  - "Personal"\n` +
      "```\n\n" +
      `## Compose payload\n\n` +
      "```yaml\n" +
      `source_context: "Sibling plugin reply — DECOY"\n` +
      `draft_title: "${DECOY_TITLE}"\n` +
      `draft_body: "DECOY_BODY_DO_NOT_USE"\n` +
      `target_folder: "DECOY_FOLDER"\n` +
      `available_folders:\n  - "DECOY_FOLDER"\n` +
      "```\n";
    const files = { "actions/cross-src-1.md": actionFile };
    const result = await createNoteViewTool.handle(
      { action_id: "cross-src-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    // Must use the namespaced section's values
    expect(sc.draft_title).toBe(NAMESPACED_TITLE);
    expect(sc.draft_body).toBe("Body from the namespaced section");
    expect(sc.target_folder).toBe("Work");
    // Must NOT fall through to the bare decoy section
    expect(sc.draft_title).not.toBe(DECOY_TITLE);
  });
});

describe("agntux_apple_notes_create_note render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await createNoteViewTool.handle(
      {} as { action_id: string },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(
        CREATE_KEPT_KEYS.has(k),
        `unexpected key "${k}" in create-note placeholder`,
      ).toBe(true);
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws a NON-ViewToolFsError", async () => {
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => {
      throw new Error("boom: backend unavailable");
    };
    const result = await createNoteViewTool.handle(
      { action_id: "anything" },
      ctx,
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

describe("agntux_apple_notes_create_note response envelope guard", () => {
  function assertEnvelope(content: unknown) {
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0].type).toBe("text");
    const text = content[0].text as string;
    // Frozen anchor strings from @agntux/plugin-runtime/render-confirmation.ts
    expect(text).toContain("iframe");
    expect(text).toContain("host");
    expect(text).toContain("MCP App");
  }

  it("success path ships the canonical content[] explanation", async () => {
    const files = {
      "actions/env-c1.md": makeCreateNoteActionFile({ id: "env-c1" }),
    };
    const result = await createNoteViewTool.handle(
      { action_id: "env-c1" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("missing-file error branch also ships the canonical content[] explanation", async () => {
    const result = await createNoteViewTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    assertEnvelope(result.content);
  });
});

// =============================================================================
// UPDATE-NOTE
// =============================================================================

describe("agntux_apple_notes_update_note payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    const heavyContent = "C".repeat(8000); // exercise large note body
    const heavyBody = "B".repeat(8000);
    const files = {
      "actions/update-1.md": makeUpdateNoteActionFile({
        id: "update-1",
        note_name: "My Shopping List",
        current_content: heavyContent,
        draft_body: heavyBody,
        is_checklist: false,
      }),
    };
    const result = await updateNoteViewTool.handle(
      { action_id: "update-1" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    // Sanity: note_name was forwarded (proves the payload is non-trivial)
    expect((sc as Record<string, unknown>).note_name).toBe("My Shopping List");
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/update-k1.md": makeUpdateNoteActionFile({ id: "update-k1" }),
    };
    const result = await updateNoteViewTool.handle(
      { action_id: "update-k1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const keys = new Set(Object.keys(sc));
    for (const k of keys) {
      expect(
        UPDATE_KEPT_KEYS.has(k),
        `unexpected key "${k}" in update-note structuredContent`,
      ).toBe(true);
    }
    for (const k of UPDATE_KEPT_KEYS) {
      expect(
        keys.has(k),
        `missing required key "${k}" in update-note structuredContent`,
      ).toBe(true);
    }
  });

  it("returns sensible field values from the compose payload section", async () => {
    const files = {
      "actions/update-v1.md": makeUpdateNoteActionFile({
        id: "update-v1",
        note_name: "Shopping List",
        folder: "Personal",
        source_context: "Grocery errand",
        is_checklist: false,
      }),
    };
    const result = await updateNoteViewTool.handle(
      { action_id: "update-v1" },
      makeCtx(files),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.action_id).toBe("update-v1");
    expect(sc.note_name).toBe("Shopping List");
    expect(sc.folder).toBe("Personal");
    expect(typeof sc.is_checklist).toBe("boolean");
    expect(Array.isArray(sc.checklist_items)).toBe(true);
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    const result = await updateNoteViewTool.handle(
      { action_id: "does-not-exist" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });
});

describe("agntux_apple_notes_update_note render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await updateNoteViewTool.handle(
      {} as { action_id: string },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    for (const k of Object.keys(sc)) {
      expect(
        UPDATE_KEPT_KEYS.has(k),
        `unexpected key "${k}" in update-note placeholder`,
      ).toBe(true);
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws a NON-ViewToolFsError", async () => {
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => {
      throw new Error("boom: backend unavailable");
    };
    const result = await updateNoteViewTool.handle(
      { action_id: "anything" },
      ctx,
    );
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

describe("agntux_apple_notes_update_note response envelope guard", () => {
  function assertEnvelope(content: unknown) {
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0].type).toBe("text");
    const text = content[0].text as string;
    // Frozen anchor strings from @agntux/plugin-runtime/render-confirmation.ts
    expect(text).toContain("iframe");
    expect(text).toContain("host");
    expect(text).toContain("MCP App");
  }

  it("success path ships the canonical content[] explanation", async () => {
    const files = {
      "actions/env-u1.md": makeUpdateNoteActionFile({ id: "env-u1" }),
    };
    const result = await updateNoteViewTool.handle(
      { action_id: "env-u1" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("missing-file error branch also ships the canonical content[] explanation", async () => {
    const result = await updateNoteViewTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    assertEnvelope(result.content);
  });
});

// =============================================================================
// Descriptor contract — view tool names and resource URIs
// =============================================================================

describe("view tool descriptors", () => {
  it("create-note tool name matches listing.yaml view_tool", () => {
    // Verbatim from agntux-apple-notes-view.ts descriptor.name
    expect(createNoteViewTool.descriptor.name).toBe(
      "agntux_apple_notes_create_note",
    );
  });

  it("update-note tool name matches listing.yaml view_tool", () => {
    // Verbatim from agntux-apple-notes-view.ts descriptor.name
    expect(updateNoteViewTool.descriptor.name).toBe(
      "agntux_apple_notes_update_note",
    );
  });

  it("create-note resource URI matches listing.yaml resource_uri", () => {
    // Verbatim from agntux-apple-notes-view.ts CREATE_NOTE_RESOURCE_URI
    expect(createNoteViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-apple-notes/create-note",
    );
  });

  it("update-note resource URI matches listing.yaml resource_uri", () => {
    // Verbatim from agntux-apple-notes-view.ts UPDATE_NOTE_RESOURCE_URI
    expect(updateNoteViewTool.descriptor.ui_resource_uri).toBe(
      "ui://agntux-apple-notes/update-note",
    );
  });

  it("create-note outputSchema requires exactly the CREATE_KEPT_KEYS", () => {
    const schema = createNoteViewTool.descriptor.outputSchema as {
      required: string[];
    };
    const required = new Set(schema.required);
    for (const k of CREATE_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(
        true,
      );
    }
    expect(schema.required.length).toBe(CREATE_KEPT_KEYS.size);
  });

  it("update-note outputSchema requires exactly the UPDATE_KEPT_KEYS", () => {
    const schema = updateNoteViewTool.descriptor.outputSchema as {
      required: string[];
    };
    const required = new Set(schema.required);
    for (const k of UPDATE_KEPT_KEYS) {
      expect(required.has(k), `outputSchema missing required key "${k}"`).toBe(
        true,
      );
    }
    expect(schema.required.length).toBe(UPDATE_KEPT_KEYS.size);
  });

  it("module exports exactly 2 view tools", () => {
    expect(mod.viewTools).toHaveLength(2);
  });
});

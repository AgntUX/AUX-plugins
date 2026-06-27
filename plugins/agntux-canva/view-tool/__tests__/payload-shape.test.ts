/**
 * payload-shape.test.ts — agntux-canva view-tool
 *
 * Asserts that each view-tool handler:
 *   1. Returns the expected structuredContent keys for real args.
 *   2. Returns a valid (placeholder) structuredContent for empty args {}.
 *   3. Does NOT throw for empty args (render-safe contract).
 *
 * Assertion targets are derived from the handler's ACTUAL output (calling
 * viewTool.handle() with in-memory fixtures). Key sets and types match the
 * outputSchema.required declared in agntux-canva-view.ts lines 87-97 (reply),
 * 181-187 (comment), and 293-302 (export) — confirmed by reading those files
 * at authoring time.
 *
 * Payload budget: all three handlers return small objects — well under 4 KB.
 * The per-field type assertions are the shape contract; no byte-count cap is
 * asserted because the objects are always small and have no variable-length
 * lists beyond available_formats (bounded to connector-declared format types).
 *
 * Source: view-tool/src/agntux-canva-view.ts
 */

import { describe, it, expect } from "vitest";
import handler from "../src/agntux-canva-view.js";

// ---------------------------------------------------------------------------
// Minimal mock ViewToolContext
// ---------------------------------------------------------------------------
const mockCtx = {
  fs: {
    readFile: async () => Buffer.from(""),
    readMany: async () => [],
    list: async () => [],
    listWithMeta: async () => [],
    exists: async () => false,
    writeFile: async () => ({ new_sha256: "", seq: 0, container_id: "" }),
    update: async () => ({ new_sha256: "", seq: 0, container_id: "" }),
    deleteFile: async () => ({ new_sha256: "", seq: 0, container_id: "" }),
  },
  scope: { user_id: "u1", organization_id: "o1" },
  now: () => new Date("2026-06-26T00:00:00Z"),
  log: () => undefined,
  withScope: function (extra: object) {
    return { ...this, scope: { ...this.scope, ...extra } };
  },
} as unknown as import("@agntux/plugin-runtime").ViewToolContext;

const [replyTool, commentTool, exportTool] = handler.viewTools;

// ---------------------------------------------------------------------------
// agntux_canva_reply
// Keys: design_url, design_id, design_title, comment_id, comment_author,
//       comment_excerpt, draft_body, personalization_signals
// Derived from: replyDescriptor.outputSchema.required (lines 87-97)
//               + handler.handle() return in-memory call
// ---------------------------------------------------------------------------
describe("agntux_canva_reply", () => {
  it("returns required structuredContent keys for real args", async () => {
    const result = await replyTool.handle(
      {
        design_url: "https://www.canva.com/design/DABCDEfghij/view",
        design_id: "DABCDEfghij",
        design_title: "Q3 Campaign Brief",
        comment_id: "comment001",
        comment_author: "Jane Smith",
        comment_excerpt: "Can you update the color palette?",
        draft_body: "Sure, I'll update it to the brand colors.",
        personalization_signals: "tone: concise",
      },
      mockCtx,
    );
    const sc = result.structuredContent;
    expect(typeof sc.design_url).toBe("string");
    expect(typeof sc.design_id).toBe("string");
    expect(typeof sc.design_title).toBe("string");
    expect(typeof sc.comment_id).toBe("string");
    expect(typeof sc.comment_author).toBe("string");
    expect(typeof sc.comment_excerpt).toBe("string");
    expect(typeof sc.draft_body).toBe("string");
    expect(typeof sc.personalization_signals).toBe("string");
  });

  it("passes through real arg values into structuredContent", async () => {
    const result = await replyTool.handle(
      {
        design_url: "https://www.canva.com/design/DABCDEfghij/view",
        design_id: "DABCDEfghij",
        design_title: "Q3 Campaign Brief",
        comment_id: "comment001",
        comment_author: "Jane Smith",
        comment_excerpt: "Can you update the color palette?",
        draft_body: "Sure, I'll update it to the brand colors.",
        personalization_signals: "tone: concise",
      },
      mockCtx,
    );
    const sc = result.structuredContent;
    expect(sc.design_id).toBe("DABCDEfghij");
    expect(sc.comment_id).toBe("comment001");
    expect(sc.draft_body).toBe("Sure, I'll update it to the brand colors.");
  });

  it("does not throw for empty args and returns placeholder shape", async () => {
    const result = await replyTool.handle({}, mockCtx);
    const sc = result.structuredContent;
    expect(sc).toBeTruthy();
    // Empty args produce empty strings (not undefined / null / throws)
    expect(typeof sc.design_id).toBe("string");
    expect(typeof sc.comment_id).toBe("string");
    expect(typeof sc.draft_body).toBe("string");
    expect(typeof sc.personalization_signals).toBe("string");
  });

  it("structuredContent has exactly the eight declared keys", async () => {
    const result = await replyTool.handle(
      {
        design_url: "https://www.canva.com/design/DABCDEfghij/view",
        design_id: "DABCDEfghij",
        design_title: "Brief",
        comment_id: "c1",
        comment_author: "Alice",
        comment_excerpt: "Looks great!",
        draft_body: "Thanks!",
        personalization_signals: "",
      },
      mockCtx,
    );
    const keys = Object.keys(result.structuredContent).sort();
    expect(keys).toEqual(
      [
        "comment_author",
        "comment_excerpt",
        "comment_id",
        "design_id",
        "design_title",
        "design_url",
        "draft_body",
        "personalization_signals",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// agntux_canva_comment
// Keys: design_url, design_id, design_title, draft_body, personalization_signals
// Derived from: commentDescriptor.outputSchema.required (lines 181-187)
// ---------------------------------------------------------------------------
describe("agntux_canva_comment", () => {
  it("returns required structuredContent keys for real args", async () => {
    const result = await commentTool.handle(
      {
        design_url: "https://www.canva.com/design/DAXYZxyz789/view",
        design_id: "DAXYZxyz789",
        design_title: "Product Launch Deck",
        draft_body: "The slide 4 header needs a comma.",
        personalization_signals: "role: designer",
      },
      mockCtx,
    );
    const sc = result.structuredContent;
    expect(typeof sc.design_url).toBe("string");
    expect(typeof sc.design_id).toBe("string");
    expect(typeof sc.design_title).toBe("string");
    expect(typeof sc.draft_body).toBe("string");
    expect(typeof sc.personalization_signals).toBe("string");
  });

  it("passes through real arg values into structuredContent", async () => {
    const result = await commentTool.handle(
      {
        design_url: "https://www.canva.com/design/DAXYZxyz789/view",
        design_id: "DAXYZxyz789",
        design_title: "Product Launch Deck",
        draft_body: "Great work on the layout!",
        personalization_signals: "",
      },
      mockCtx,
    );
    const sc = result.structuredContent;
    expect(sc.design_id).toBe("DAXYZxyz789");
    expect(sc.draft_body).toBe("Great work on the layout!");
  });

  it("does not throw for empty args and returns placeholder shape", async () => {
    const result = await commentTool.handle({}, mockCtx);
    const sc = result.structuredContent;
    expect(sc).toBeTruthy();
    expect(typeof sc.design_id).toBe("string");
    expect(typeof sc.draft_body).toBe("string");
    expect(typeof sc.personalization_signals).toBe("string");
  });

  it("structuredContent has exactly the five declared keys", async () => {
    const result = await commentTool.handle(
      {
        design_url: "https://www.canva.com/design/DAXYZxyz789/view",
        design_id: "DAXYZxyz789",
        design_title: "Deck",
        draft_body: "LGTM",
        personalization_signals: "",
      },
      mockCtx,
    );
    const keys = Object.keys(result.structuredContent).sort();
    expect(keys).toEqual(
      [
        "design_id",
        "design_title",
        "design_url",
        "draft_body",
        "personalization_signals",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// agntux_canva_export
// Keys: design_url, design_id, design_title, available_formats (array),
//       default_format, page_count (number)
// Derived from: exportDescriptor.outputSchema.required (lines 293-302)
// ---------------------------------------------------------------------------
describe("agntux_canva_export", () => {
  it("returns required structuredContent keys for real args", async () => {
    const result = await exportTool.handle(
      {
        design_url: "https://www.canva.com/design/DApqrstu123/view",
        design_id: "DApqrstu123",
        design_title: "Annual Report",
        available_formats: ["pdf", "png", "pptx"],
        default_format: "pdf",
        page_count: 12,
      },
      mockCtx,
    );
    const sc = result.structuredContent;
    expect(typeof sc.design_url).toBe("string");
    expect(typeof sc.design_id).toBe("string");
    expect(typeof sc.design_title).toBe("string");
    expect(Array.isArray(sc.available_formats)).toBe(true);
    expect(typeof sc.default_format).toBe("string");
    expect(typeof sc.page_count).toBe("number");
  });

  it("passes through real arg values for format and page_count", async () => {
    const result = await exportTool.handle(
      {
        design_url: "https://www.canva.com/design/DApqrstu123/view",
        design_id: "DApqrstu123",
        design_title: "Annual Report",
        available_formats: ["pdf", "png", "pptx"],
        default_format: "pdf",
        page_count: 12,
      },
      mockCtx,
    );
    const sc = result.structuredContent;
    expect(sc.design_id).toBe("DApqrstu123");
    expect(sc.available_formats).toEqual(["pdf", "png", "pptx"]);
    expect(sc.default_format).toBe("pdf");
    expect(sc.page_count).toBe(12);
  });

  it("does not throw for empty args and returns placeholder shape", async () => {
    const result = await exportTool.handle({}, mockCtx);
    const sc = result.structuredContent;
    expect(sc).toBeTruthy();
    expect(typeof sc.design_id).toBe("string");
    expect(Array.isArray(sc.available_formats)).toBe(true);
    expect(typeof sc.page_count).toBe("number");
  });

  it("empty available_formats arg produces an empty array (not null/undefined)", async () => {
    // safeFormatArray guard in agntux-canva-view.ts line 234
    const result = await exportTool.handle(
      {
        design_url: "",
        design_id: "DAtest00000",
        design_title: "Empty",
        available_formats: [],
        default_format: "",
        page_count: 1,
      },
      mockCtx,
    );
    expect(Array.isArray(result.structuredContent.available_formats)).toBe(true);
    expect(result.structuredContent.available_formats).toHaveLength(0);
  });

  it("page_count defaults to 1 when not provided", async () => {
    // Derived from handler line 321: page_count defaults to 1
    const result = await exportTool.handle(
      {
        design_id: "DAtestABCDE",
        design_title: "No Pages",
        available_formats: ["pdf"],
        default_format: "pdf",
      },
      mockCtx,
    );
    expect(result.structuredContent.page_count).toBe(1);
  });

  it("default_format falls back to first available format when not provided", async () => {
    // Derived from handler lines 315-320: if default_format not in args,
    // use formats[0] if available, else "pdf"
    const result = await exportTool.handle(
      {
        design_id: "DAtestXYZAB",
        design_title: "Fallback Test",
        available_formats: ["png", "jpg"],
        page_count: 3,
      },
      mockCtx,
    );
    expect(result.structuredContent.default_format).toBe("png");
  });

  it("default_format falls back to 'pdf' when available_formats is empty", async () => {
    // Derived from handler line 320: else "pdf"
    const result = await exportTool.handle(
      {
        design_id: "DAtestEMPTY",
        design_title: "No Formats",
        available_formats: [],
        page_count: 1,
      },
      mockCtx,
    );
    expect(result.structuredContent.default_format).toBe("pdf");
  });

  it("structuredContent has exactly the six declared keys", async () => {
    const result = await exportTool.handle(
      {
        design_url: "https://www.canva.com/design/DApqrstu123/view",
        design_id: "DApqrstu123",
        design_title: "Report",
        available_formats: ["pdf"],
        default_format: "pdf",
        page_count: 5,
      },
      mockCtx,
    );
    const keys = Object.keys(result.structuredContent).sort();
    expect(keys).toEqual(
      [
        "available_formats",
        "default_format",
        "design_id",
        "design_title",
        "design_url",
        "page_count",
      ].sort(),
    );
  });
});

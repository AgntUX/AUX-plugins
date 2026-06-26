/**
 * payload-shape.test.ts
 *
 * Asserts that each view-tool handler:
 * 1. Returns a valid structuredContent shape for real args.
 * 2. Returns a valid (placeholder) structuredContent for empty args {}.
 * 3. Does NOT throw for empty args (render-safe contract).
 */

import { describe, it, expect } from "vitest";
import handler from "../agntux-asana-view.js";

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
  withScope: function (extra: object) { return { ...this, scope: { ...this.scope, ...extra } }; },
} as unknown as import("@agntux/plugin-runtime").ViewToolContext;

const [commentTool, completeTool, assignTool, createTool] = handler.viewTools;

// ---------------------------------------------------------------------------
// comment
// ---------------------------------------------------------------------------
describe("agntux_asana_comment", () => {
  it("returns required structuredContent keys for real args", async () => {
    const result = await commentTool.handle(
      {
        task_gid: "111",
        task_url: "https://app.asana.com/0/p/111",
        task_title: "Fix the thing",
        project_name: "Engineering",
        due_on: "2026-07-01",
        draft_body: "Looks good to me.",
        personalization_signals: "assigned to me",
      },
      mockCtx,
    );
    const sc = result.structuredContent;
    expect(typeof sc.task_gid).toBe("string");
    expect(typeof sc.task_url).toBe("string");
    expect(typeof sc.task_title).toBe("string");
    expect(typeof sc.project_name).toBe("string");
    expect(typeof sc.due_on).toBe("string");
    expect(typeof sc.draft_body).toBe("string");
    expect(typeof sc.personalization_signals).toBe("string");
  });

  it("does not throw for empty args and returns placeholder shape", async () => {
    const result = await commentTool.handle({}, mockCtx);
    const sc = result.structuredContent;
    expect(sc).toBeTruthy();
    expect(typeof sc.task_gid).toBe("string");
    expect(typeof sc.draft_body).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------
describe("agntux_asana_complete", () => {
  it("returns required structuredContent keys for real args", async () => {
    const result = await completeTool.handle(
      {
        task_gid: "222",
        task_url: "https://app.asana.com/0/p/222",
        task_title: "Deploy to prod",
        project_name: "Infra",
        completed: false,
        due_on: "2026-06-30",
      },
      mockCtx,
    );
    const sc = result.structuredContent;
    expect(typeof sc.task_gid).toBe("string");
    expect(typeof sc.completed).toBe("boolean");
    expect(typeof sc.due_on).toBe("string");
  });

  it("does not throw for empty args", async () => {
    const result = await completeTool.handle({}, mockCtx);
    expect(result.structuredContent).toBeTruthy();
    expect(typeof result.structuredContent.completed).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// assign
// ---------------------------------------------------------------------------
describe("agntux_asana_assign", () => {
  it("returns required structuredContent keys for real args", async () => {
    const result = await assignTool.handle(
      {
        task_gid: "333",
        task_url: "https://app.asana.com/0/p/333",
        task_title: "Write RFC",
        current_assignee: "Alice",
        candidate_assignees: [
          { gid: "g1", name: "Bob" },
          { gid: "g2", name: "Carol" },
        ],
        note_body: "Reassigning due to PTO.",
      },
      mockCtx,
    );
    const sc = result.structuredContent;
    expect(typeof sc.task_gid).toBe("string");
    expect(Array.isArray(sc.candidate_assignees)).toBe(true);
    expect(sc.candidate_assignees).toHaveLength(2);
  });

  it("does not throw for empty args", async () => {
    const result = await assignTool.handle({}, mockCtx);
    expect(result.structuredContent).toBeTruthy();
    expect(Array.isArray(result.structuredContent.candidate_assignees)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
describe("agntux_asana_create", () => {
  it("returns required structuredContent keys for real args", async () => {
    const result = await createTool.handle(
      {
        parent_task_title: "Fix auth bug",
        draft_name: "Write regression test for auth bug",
        candidate_assignees: [{ gid: "g3", name: "Dave" }],
        due_on: "2026-07-10",
        candidate_projects: [{ gid: "p1", name: "Backend" }],
      },
      mockCtx,
    );
    const sc = result.structuredContent;
    expect(typeof sc.parent_task_title).toBe("string");
    expect(typeof sc.draft_name).toBe("string");
    expect(Array.isArray(sc.candidate_assignees)).toBe(true);
    expect(Array.isArray(sc.candidate_projects)).toBe(true);
  });

  it("does not throw for empty args", async () => {
    const result = await createTool.handle({}, mockCtx);
    expect(result.structuredContent).toBeTruthy();
    expect(Array.isArray(result.structuredContent.candidate_assignees)).toBe(true);
    expect(Array.isArray(result.structuredContent.candidate_projects)).toBe(true);
  });
});

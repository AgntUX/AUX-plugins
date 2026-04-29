/**
 * mutator-tools.test.ts
 *
 * Unit tests for the MCP server mutator tools: snooze, dismiss, set_status, pivot.
 * These import the compiled dist/ files and test real logic against temp files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We import from the mcp-server dist (pre-built).
// The path traversal guard uses homedir() from node:os — we can't override that
// from outside the module, so we test with the real user home path for the
// guard tests, and use a real actions dir for the write tests.
const MCP_DIST = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "../mcp-server/dist");

const ACTIONS_DIR_REAL = join(process.env.HOME ?? "/tmp", "agntux", "actions");

const SAMPLE_FM = `---
id: test-action-001
type: action-item
schema_version: "1.0.0"
status: open
priority: high
reason_class: deadline
created_at: 2026-04-25T14:22:00Z
source: slack
source_ref: T01_test
completed_at: null
dismissed_at: null
snoozed_until: null
---

## Why this matters
Test action for mutator tools.
`;

let tmpActionsDir: string;
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = join(tmpdir(), `mutator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpActionsDir = join(tmpRoot, "agntux", "actions");
  mkdirSync(tmpActionsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// setFrontmatter (shared utility) — tested via the compiled module
// ---------------------------------------------------------------------------

describe("setFrontmatter utility", async () => {
  const { setFrontmatter } = await import(`${MCP_DIST}/frontmatter.js`);

  it("patches status field", () => {
    const result = setFrontmatter(SAMPLE_FM, { status: "done" });
    expect(result).toContain("status: done");
    expect(result).not.toContain("status: open");
  });

  it("patches snoozed_until", () => {
    const result = setFrontmatter(SAMPLE_FM, {
      status: "snoozed",
      snoozed_until: "2026-05-01T09:00:00Z",
    });
    expect(result).toContain("snoozed_until: 2026-05-01T09:00:00Z");
  });

  it("preserves body verbatim", () => {
    const result = setFrontmatter(SAMPLE_FM, { status: "done" });
    expect(result).toContain("## Why this matters\nTest action for mutator tools.");
  });

  it("serialises null correctly", () => {
    const result = setFrontmatter(SAMPLE_FM, { completed_at: null });
    expect(result).toContain("completed_at: null");
  });
});

// ---------------------------------------------------------------------------
// snooze tool
// ---------------------------------------------------------------------------

describe("snooze tool", async () => {
  const { snoozeTool } = await import(`${MCP_DIST}/tools/snooze.js`);

  it("rejects missing id", async () => {
    await expect(snoozeTool.handler({ until: "2026-05-01" })).rejects.toThrow("id is required");
  });

  it("rejects missing until", async () => {
    await expect(snoozeTool.handler({ id: "foo" })).rejects.toThrow("until is required");
  });

  it("rejects path traversal in id", async () => {
    await expect(
      snoozeTool.handler({ id: "../../../etc/passwd", until: "2026-05-01" })
    ).rejects.toThrow(/traversal/i);
  });

  it("has correct inputSchema", () => {
    expect(snoozeTool.inputSchema.required).toContain("id");
    expect(snoozeTool.inputSchema.required).toContain("until");
  });
});

// ---------------------------------------------------------------------------
// dismiss tool
// ---------------------------------------------------------------------------

describe("dismiss tool", async () => {
  const { dismissTool } = await import(`${MCP_DIST}/tools/dismiss.js`);

  it("rejects missing id", async () => {
    await expect(dismissTool.handler({})).rejects.toThrow("id is required");
  });

  it("rejects path traversal in id", async () => {
    await expect(
      dismissTool.handler({ id: "../../etc/shadow" })
    ).rejects.toThrow(/traversal/i);
  });

  it("has correct inputSchema", () => {
    expect(dismissTool.inputSchema.required).toContain("id");
  });
});

// ---------------------------------------------------------------------------
// set_status tool
// ---------------------------------------------------------------------------

describe("set_status tool", async () => {
  const { setStatusTool } = await import(`${MCP_DIST}/tools/set-status.js`);

  it("rejects invalid status", async () => {
    await expect(
      setStatusTool.handler({ id: "foo", status: "invalid-status" })
    ).rejects.toThrow(/Invalid status/);
  });

  it("rejects snoozed without snoozed_until", async () => {
    await expect(
      setStatusTool.handler({ id: "foo", status: "snoozed" })
    ).rejects.toThrow(/snoozed_until is required/);
  });

  it("rejects path traversal", async () => {
    await expect(
      setStatusTool.handler({ id: "../foo", status: "done" })
    ).rejects.toThrow(/traversal/i);
  });

  it("inputSchema lists all valid statuses", () => {
    const statusProp = setStatusTool.inputSchema.properties.status;
    expect(statusProp.enum).toContain("open");
    expect(statusProp.enum).toContain("snoozed");
    expect(statusProp.enum).toContain("done");
    expect(statusProp.enum).toContain("dismissed");
  });
});

// ---------------------------------------------------------------------------
// pivot tool
// ---------------------------------------------------------------------------

describe("pivot tool", async () => {
  const { pivotTool } = await import(`${MCP_DIST}/tools/pivot.js`);

  it("rejects missing subtype", async () => {
    await expect(
      pivotTool.handler({ slug: "acme-corp" })
    ).rejects.toThrow("subtype is required");
  });

  it("rejects missing slug", async () => {
    await expect(
      pivotTool.handler({ subtype: "companies" })
    ).rejects.toThrow("slug is required");
  });

  it("rejects path traversal in subtype", async () => {
    await expect(
      pivotTool.handler({ subtype: "../../../etc", slug: "passwd" })
    ).rejects.toThrow(/traversal/i);
  });

  it("returns host_prompt in _meta", async () => {
    const result = await pivotTool.handler({ subtype: "companies", slug: "acme-corp" });
    expect(result._meta?.host_prompt).toBeDefined();
    expect(result._meta?.entity?.subtype).toBe("companies");
    expect(result._meta?.entity?.slug).toBe("acme-corp");
  });

  it("content text contains entity reference", async () => {
    const result = await pivotTool.handler({ subtype: "companies", slug: "acme-corp" });
    const text = result.content?.[0]?.text ?? "";
    expect(text).toMatch(/companies.*acme-corp|acme-corp.*companies/);
  });
});

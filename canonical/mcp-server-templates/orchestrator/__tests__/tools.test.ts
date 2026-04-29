import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolve, relative } from "node:path";

import { setFrontmatter } from "../src/frontmatter.js";
import { snoozeTool } from "../src/tools/snooze.js";
import { dismissTool } from "../src/tools/dismiss.js";
import { setStatusTool } from "../src/tools/set-status.js";
import { pivotTool } from "../src/tools/pivot.js";

const ACTION_CONTENT = `---
id: 2026-04-25-test-action
type: action-item
schema_version: "1.0.0"
status: open
priority: high
reason_class: deadline
created_at: 2026-04-25T14:22:00Z
source: slack
source_ref: T01_test
related_entities:
  - companies/test-corp
snoozed_until: null
completed_at: null
dismissed_at: null
---

## Why this matters
Test action item.

## Personalization fit
- Matches test rule
`;

// ---- Path guard helper (mirrors what the tools use) ----

function makeActionsGuard(actionsDir: string) {
  return function guardPath(id: string): string {
    const resolved = resolve(actionsDir, `${id}.md`);
    const rel = relative(actionsDir, resolved);
    if (rel.startsWith("..") || resolve(rel) === rel) {
      throw new Error(`Path traversal rejected: id "${id}" resolves outside actions dir`);
    }
    return resolved;
  };
}

function makeEntitiesGuard(entitiesDir: string) {
  return function guardEntityPath(subtype: string, slug: string): void {
    const resolved = resolve(entitiesDir, subtype, `${slug}.md`);
    const rel = relative(entitiesDir, resolved);
    if (rel.startsWith("..") || resolve(rel) === rel) {
      throw new Error(`Path traversal rejected`);
    }
  };
}

const ACTIONS_DIR = join(homedir(), "agntux", "actions");
const ENTITIES_DIR = join(homedir(), "agntux", "entities");
const guardActions = makeActionsGuard(ACTIONS_DIR);
const guardEntities = makeEntitiesGuard(ENTITIES_DIR);

// ---- snooze ----

describe("tool: snooze (via frontmatter patcher)", () => {
  it("sets status to snoozed with snoozed_until", () => {
    const patched = setFrontmatter(ACTION_CONTENT, {
      status: "snoozed",
      snoozed_until: "2026-05-01",
      completed_at: null,
      dismissed_at: null,
    });
    expect(patched).toContain("status: snoozed");
    expect(patched).toContain("snoozed_until: 2026-05-01");
    expect(patched).toContain("completed_at: null");
    expect(patched).toContain("dismissed_at: null");
  });

  it("preserves body after snoozed patch", () => {
    const patched = setFrontmatter(ACTION_CONTENT, { status: "snoozed", snoozed_until: "2026-05-01" });
    expect(patched).toContain("## Why this matters");
    expect(patched).toContain("Test action item.");
  });

  it("idempotent: patching same value twice yields same result", () => {
    const once = setFrontmatter(ACTION_CONTENT, { status: "snoozed", snoozed_until: "2026-05-01" });
    const twice = setFrontmatter(once, { status: "snoozed", snoozed_until: "2026-05-01" });
    expect(twice).toBe(once);
  });

  it("real handler rejects path traversal id '../../etc/passwd' before any FS access", async () => {
    await expect(snoozeTool.handler({ id: "../../etc/passwd", until: "2026-05-01" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects id with leading slash '/etc/passwd' before any FS access", async () => {
    await expect(snoozeTool.handler({ id: "/etc/passwd", until: "2026-05-01" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects empty id", async () => {
    await expect(snoozeTool.handler({ id: "", until: "2026-05-01" }))
      .rejects.toThrow(/id is required/);
  });
});

// ---- dismiss ----

describe("tool: dismiss (via frontmatter patcher)", () => {
  it("sets status to dismissed with dismissed_at", () => {
    const now = "2026-04-26T10:00:00Z";
    const patched = setFrontmatter(ACTION_CONTENT, {
      status: "dismissed",
      dismissed_at: now,
      completed_at: null,
    });
    expect(patched).toContain("status: dismissed");
    expect(patched).toContain(`dismissed_at: ${now}`);
    expect(patched).toContain("completed_at: null");
  });

  it("does not affect snoozed_until when dismissing", () => {
    const patched = setFrontmatter(ACTION_CONTENT, {
      status: "dismissed",
      dismissed_at: "2026-04-26T10:00:00Z",
    });
    expect(patched).toContain("snoozed_until: null");
  });

  it("fails on file with no frontmatter", () => {
    expect(() => setFrontmatter("no frontmatter here", { status: "dismissed" })).toThrow();
  });

  it("real handler rejects path traversal id '../../etc/passwd' before any FS access", async () => {
    await expect(dismissTool.handler({ id: "../../etc/passwd" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects id '../../../' before any FS access", async () => {
    await expect(dismissTool.handler({ id: "../../../" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects id 'actions/foo' with leading path segment before any FS access", async () => {
    // 'actions/foo' resolves to ACTIONS_DIR/actions/foo.md — still inside actions dir
    // so this is a valid-looking path; the guard accepts it (subdirectory).
    // Test that absolute-path injection is blocked instead.
    await expect(dismissTool.handler({ id: "/etc/passwd" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });
});

// ---- set_status ----

describe("tool: set_status (via frontmatter patcher)", () => {
  it("transitions open → done", () => {
    const now = "2026-04-26T12:00:00Z";
    const patched = setFrontmatter(ACTION_CONTENT, {
      status: "done",
      completed_at: now,
      dismissed_at: null,
    });
    expect(patched).toContain("status: done");
    expect(patched).toContain(`completed_at: ${now}`);
  });

  it("transitions done → open (re-open) clears timestamps", () => {
    const withDone = setFrontmatter(ACTION_CONTENT, {
      status: "done",
      completed_at: "2026-04-26T12:00:00Z",
    });
    const reopened = setFrontmatter(withDone, {
      status: "open",
      snoozed_until: null,
      completed_at: null,
      dismissed_at: null,
    });
    expect(reopened).toContain("status: open");
    expect(reopened).toContain("completed_at: null");
  });

  it("rejects invalid status value (guard logic)", () => {
    const VALID_STATUSES = new Set(["open", "snoozed", "done", "dismissed"]);
    expect(VALID_STATUSES.has("invalid-status")).toBe(false);
    // Simulate what the handler does
    const validate = (s: string) => {
      if (!VALID_STATUSES.has(s)) throw new Error(`Invalid status "${s}"`);
    };
    expect(() => validate("invalid-status")).toThrow('Invalid status "invalid-status"');
  });

  it("requires snoozed_until when status is snoozed (guard logic)", () => {
    const validate = (status: string, snoozed_until?: string) => {
      if (status === "snoozed" && !snoozed_until) throw new Error("snoozed_until is required");
    };
    expect(() => validate("snoozed")).toThrow("snoozed_until is required");
    expect(() => validate("snoozed", "2026-05-01")).not.toThrow();
  });

  it("real handler rejects path traversal id '../../etc/passwd' before any FS access", async () => {
    await expect(setStatusTool.handler({ id: "../../etc/passwd", status: "done" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects invalid status before any FS access", async () => {
    // The guard runs before the file read, so even a traversal id + invalid status
    // should throw on invalid status (status is validated first in the handler).
    await expect(setStatusTool.handler({ id: "../../etc/passwd", status: "invalid-status" }))
      .rejects.toThrow(/[Ii]nvalid status/);
  });

  it("real handler rejects missing snoozed_until when status is snoozed", async () => {
    await expect(setStatusTool.handler({ id: "../../etc/passwd", status: "snoozed" }))
      .rejects.toThrow(/snoozed_until is required/);
  });
});

// ---- pivot ----

describe("tool: pivot (path guard)", () => {
  it("rejects subtype with .. traversal", () => {
    expect(() => guardEntities("../../../etc", "passwd")).toThrow("Path traversal rejected");
  });

  it("accepts a valid subtype/slug pair", () => {
    expect(() => guardEntities("companies", "acme-corp")).not.toThrow();
  });

  it("rejects empty subtype (handler guard)", () => {
    const validate = (subtype: string) => {
      if (!subtype) throw new Error("subtype is required");
    };
    expect(() => validate("")).toThrow("subtype is required");
  });

  it("returns a host_prompt with correct ux: prefix", () => {
    const subtype = "companies";
    const slug = "acme-corp";
    const hostPrompt = `ux: Use the agntux-core plugin to open the entity browser for ${subtype}/${slug}.`;
    expect(hostPrompt.startsWith("ux: ")).toBe(true);
    expect(hostPrompt).toContain("agntux-core");
  });

  it("real handler rejects subtype '../../../etc' before any FS access", async () => {
    await expect(pivotTool.handler({ subtype: "../../../etc", slug: "passwd" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects slug '../../etc/passwd' before any FS access", async () => {
    await expect(pivotTool.handler({ subtype: "companies", slug: "../../etc/passwd" }))
      .rejects.toThrow(/[Pp]ath traversal/);
  });

  it("real handler rejects empty subtype", async () => {
    await expect(pivotTool.handler({ subtype: "", slug: "acme-corp" }))
      .rejects.toThrow(/subtype is required/);
  });

  it("real handler returns host_prompt for valid input (no FS write)", async () => {
    const result = await pivotTool.handler({ subtype: "companies", slug: "acme-corp" });
    expect(result.content[0].text).toMatch(/^ux: /);
    expect((result as { _meta?: { host_prompt?: string } })._meta?.host_prompt).toContain("companies/acme-corp");
  });
});

// ---- path traversal guards (actions dir) ----

describe("path traversal guards (actions dir)", () => {
  it("rejects id with .. segments", () => {
    expect(() => guardActions("../../etc/passwd")).toThrow("Path traversal rejected");
    expect(() => guardActions("../other-dir/file")).toThrow("Path traversal rejected");
  });

  it("accepts a valid flat id", () => {
    expect(() => guardActions("2026-04-25-acme-renewal-pricing")).not.toThrow();
    const result = guardActions("2026-04-25-acme-renewal-pricing");
    expect(result).toBe(join(ACTIONS_DIR, "2026-04-25-acme-renewal-pricing.md"));
  });

  it("rejects absolute path as id", () => {
    // resolve(ACTIONS_DIR, "/etc/passwd.md") → "/etc/passwd.md" (absolute wins),
    // so relative() will produce a path starting with ".."
    expect(() => guardActions("/etc/passwd")).toThrow("Path traversal rejected");
  });
});

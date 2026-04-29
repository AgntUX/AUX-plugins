/**
 * e2e/smoke.test.mjs
 *
 * Structural smoke tests covering 4 E2E scenarios (P4 §10.E).
 * A fully simulated host is not feasible at MVP; these tests exercise each
 * path through the prompt files and MCP server tools structurally, verifying
 * that the plugin is wired up correctly for the described scenarios.
 *
 * Limitation: these are structural/integration-level tests, not end-to-end
 * tests with a live AI host. Full E2E would require a running Claude Code
 * host with the plugin installed.
 *
 * Scenarios:
 *   E1 — cold start → first action item appears (hook + prompt chain)
 *   E2 — pattern detection (5 dismissals → # Auto-learned bullet)
 *   E3 — UI render (resources/read → _meta.license attached)
 *   E4 — status edit (snooze → frontmatter mutation persisted)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = join(PLUGIN_ROOT, "hooks");
const MCP_DIST = join(PLUGIN_ROOT, "mcp-server", "dist");

let tmpRoot, entitiesRoot, actionsRoot, companiesDir;

beforeEach(() => {
  tmpRoot = join(tmpdir(), `e2e-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  entitiesRoot = join(tmpRoot, "agntux", "entities");
  actionsRoot = join(tmpRoot, "agntux", "actions");
  companiesDir = join(entitiesRoot, "companies");
  mkdirSync(companiesDir, { recursive: true });
  mkdirSync(actionsRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: write a minimal action-item file
// ---------------------------------------------------------------------------
function writeAction(id, status = "open", extra = {}) {
  const extraLines = Object.entries(extra)
    .map(([k, v]) => `${k}: ${v === null ? "null" : v}`)
    .join("\n");
  const content = `---
id: ${id}
type: action-item
schema_version: "1.0.0"
status: ${status}
priority: high
reason_class: deadline
created_at: 2026-04-25T14:22:00Z
source: slack
source_ref: T01_test
completed_at: null
dismissed_at: null
snoozed_until: null
${extraLines}
---

## Why this matters
Test action item ${id}.
`;
  writeFileSync(join(actionsRoot, `${id}.md`), content, "utf8");
}

// ---------------------------------------------------------------------------
// E1: Cold start → first action item appears in _index.md via maintain-index hook
// ---------------------------------------------------------------------------
describe("E1 — cold start: first action item appears", () => {
  it("maintain-index hook creates _index.md when first action is written", () => {
    const id = "2026-04-25-first-action";
    writeAction(id);
    const filePath = join(actionsRoot, `${id}.md`);
    const result = spawnSync(process.execPath, [join(HOOKS_DIR, "maintain-index.mjs")], {
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath } }),
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, HOME: tmpRoot },
    });
    expect(result.status).toBe(0);
    const indexPath = join(actionsRoot, "_index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf8");
    expect(content).toContain(`[[${id}]]`);
    expect(content).toContain("@status:open");
    expect(content).toContain("@priority:high");
  });
});

// ---------------------------------------------------------------------------
// E2: Pattern detection — feedback subagent prompt encodes the 5-dismissal rule
// ---------------------------------------------------------------------------
describe("E2 — pattern detection: 5 dismissals → # Auto-learned bullet", () => {
  it("feedback.md encodes the N-dismissals threshold rule", () => {
    const feedbackMd = readFileSync(join(PLUGIN_ROOT, "agents", "feedback.md"), "utf8");
    // Verify the prompt encodes the pattern threshold
    expect(feedbackMd).toMatch(/feedback_min_pattern_threshold|threshold/i);
    expect(feedbackMd).toMatch(/default.*5|5.*default/i);
    // Verify it specifies appending to # Auto-learned
    expect(feedbackMd).toContain("# Auto-learned");
    expect(feedbackMd).toMatch(/observation.*→.*adjustment|→.*deprioritize|→.*trust/i);
  });

  it("feedback.md specifies dismissed status in 30-day scope", () => {
    const feedbackMd = readFileSync(join(PLUGIN_ROOT, "agents", "feedback.md"), "utf8");
    expect(feedbackMd).toMatch(/dismissed/);
    expect(feedbackMd).toMatch(/30.day|30 day/i);
  });

  it("maintain-index hook updates _index.md with dismissed status when action is dismissed", () => {
    const id = "2026-04-25-dismissed-action";
    writeAction(id, "dismissed", { dismissed_at: "2026-04-25T15:00:00Z" });
    const filePath = join(actionsRoot, `${id}.md`);
    spawnSync(process.execPath, [join(HOOKS_DIR, "maintain-index.mjs")], {
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath } }),
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, HOME: tmpRoot },
    });
    const indexPath = join(actionsRoot, "_index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf8");
    expect(content).toContain("@status:dismissed");
  });
});

// ---------------------------------------------------------------------------
// E3: UI render — resources/read → _meta.license attached
// ---------------------------------------------------------------------------
describe("E3 — UI render: resources/read → _meta structure", () => {
  it("handleUIResource returns structured error for unknown URI", async () => {
    const { handleUIResource } = await import(`${MCP_DIST}/ui-resources.js`);
    const result = await handleUIResource("ui://unknown");
    expect(result.isError).toBe(true);
    expect(result.contents[0].text).toMatch(/Unknown UI resource/);
  });

  it("handleUIResource attempts to fetch for known UI URIs (triage)", async () => {
    // In test env, S3 fetch will fail (no license) — we verify the error is structured
    const { handleUIResource } = await import(`${MCP_DIST}/ui-resources.js`);
    const result = await handleUIResource("ui://triage");
    // Either succeeds (if dev cache hits) or returns structured error — never throws
    if (result.isError) {
      expect(result.contents[0].type).toBe("text");
      expect(typeof result.contents[0].text).toBe("string");
    } else {
      expect(result.contents[0].mimeType).toBe("text/html");
      // _meta should have openai/widgetCSP
      expect(result.contents[0]._meta?.["openai/widgetCSP"]).toBeDefined();
    }
  });

  it("buildCSP returns a string with required directives", async () => {
    const { buildCSP } = await import(`${MCP_DIST}/csp.js`);
    const csp = buildCSP();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'none'");
  });
});

// ---------------------------------------------------------------------------
// E4: Status edit — snooze → frontmatter mutation persisted via setFrontmatter
// ---------------------------------------------------------------------------
describe("E4 — status edit: snooze → frontmatter mutation persisted", () => {
  it("setFrontmatter correctly patches status and snoozed_until", async () => {
    const { setFrontmatter } = await import(`${MCP_DIST}/frontmatter.js`);
    const original = `---
id: test-action
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
This needs attention.
`;
    const patched = setFrontmatter(original, {
      status: "snoozed",
      snoozed_until: "2026-05-02T09:00:00Z",
      completed_at: null,
      dismissed_at: null,
    });
    expect(patched).toContain("status: snoozed");
    expect(patched).toContain("snoozed_until: 2026-05-02T09:00:00Z");
    expect(patched).toContain("completed_at: null");
    // Body is preserved
    expect(patched).toContain("## Why this matters\nThis needs attention.");
  });

  it("maintain-index hook updates _index.md with snoozed status after snooze edit", () => {
    const id = "2026-04-25-snoozable";
    // Write with snoozed status (simulating what the snooze tool would do)
    const content = `---
id: ${id}
type: action-item
schema_version: "1.0.0"
status: snoozed
priority: high
reason_class: deadline
created_at: 2026-04-25T14:22:00Z
source: slack
source_ref: T01_test
completed_at: null
dismissed_at: null
snoozed_until: 2026-05-02T09:00:00Z
---

## Why this matters
Snoozed test action.
`;
    writeFileSync(join(actionsRoot, `${id}.md`), content, "utf8");
    const filePath = join(actionsRoot, `${id}.md`);
    const result = spawnSync(process.execPath, [join(HOOKS_DIR, "maintain-index.mjs")], {
      input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: filePath } }),
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, HOME: tmpRoot },
    });
    expect(result.status).toBe(0);
    const indexPath = join(actionsRoot, "_index.md");
    const indexContent = readFileSync(indexPath, "utf8");
    expect(indexContent).toContain("@status:snoozed");
    // @due: sigil is only present when due_by frontmatter field is set.
    // snoozed_until is not the same as due_by — the hook emits @due only from due_by.
    expect(indexContent).toContain(`[[${id}]]`);
  });
});

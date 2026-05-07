// validate-cursor hook unit tests.
// Drives ../hooks/validate-cursor.mjs as a child process with synthetic
// hook context payloads. The hook is PreToolUse, so it reads the prior
// on-disk content from the file_path; we set that up in each test before
// invoking.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../hooks/validate-cursor.mjs", import.meta.url).pathname;

function runHook(ctx, agntuxRoot) {
  const result = spawnSync("node", [HOOK], {
    input: JSON.stringify(ctx),
    env: { ...process.env, HOME: agntuxRoot },
    encoding: "utf8",
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function setupAgntuxRoot() {
  const home = mkdtempSync(join(tmpdir(), "validate-cursor-"));
  // Mirror the production layout: <home>/agntux/data/{schema/contracts,learnings/<slug>}.
  mkdirSync(join(home, "agntux", "data", "schema", "contracts"), { recursive: true });
  mkdirSync(join(home, "agntux", "data", "learnings", "agntux-slack"), { recursive: true });
  // Slack contract declares a JSON-map cursor; matches the production
  // contract's frontmatter so the hook's `expectsJsonMap` heuristic fires.
  writeFileSync(
    join(home, "agntux", "data", "schema", "contracts", "agntux-slack.md"),
    `---
type: plugin-contract
plugin_slug: agntux-slack
schema_version: "1.1.0"
cursor_semantics: "Single JSON map (one line) under \`cursor\`. Two key shapes."
---

# agntux-slack contract
`
  );
  return home;
}

function syncFile(homeRoot, content) {
  const path = join(homeRoot, "agntux", "data", "learnings", "agntux-slack", "sync.md");
  writeFileSync(path, content);
  return path;
}

function syncMd({ cursor, discoveryTs, errors = "  - (none)" }) {
  return `---
type: plugin-sync-state
plugin_slug: agntux-slack
schema_version: "1.1.0"
---

# agntux-slack — sync state

- cursor: ${cursor}
- discovery_ts: ${discoveryTs}
- workspace_subdomain: oatfi
- last_run: 2026-05-07T13:00:00Z
- last_success: 2026-05-07T13:00:00Z
- items_processed: 1
- errors:
${errors}
- lock: null
`;
}

describe("validate-cursor hook", () => {
  let homeRoot;

  beforeEach(() => {
    homeRoot = setupAgntuxRoot();
  });

  afterEach(() => {
    if (homeRoot) rmSync(homeRoot, { recursive: true, force: true });
  });

  it("passes when the path is outside data/learnings/*/sync.md", () => {
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: join(homeRoot, "agntux", "user.md"),
        content: "---\ntype: user-config\n---\n",
      },
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("passes when prior sync.md does not exist (first run)", () => {
    const filePath = join(homeRoot, "agntux", "data", "learnings", "agntux-slack", "sync.md");
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: filePath,
        content: syncMd({ cursor: '{"C01":"100.0"}', discoveryTs: "100.0" }),
      },
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("passes when JSON-map cursor parses cleanly and discovery_ts advances", () => {
    const filePath = syncFile(homeRoot, syncMd({ cursor: '{"C01":"100.0"}', discoveryTs: "100.0" }));
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: filePath,
        content: syncMd({ cursor: '{"C01":"200.0"}', discoveryTs: "200.0" }),
      },
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("rejects when JSON-map cursor is unparseable", () => {
    syncFile(homeRoot, syncMd({ cursor: '{"C01":"100.0"}', discoveryTs: "100.0" }));
    const filePath = join(homeRoot, "agntux", "data", "learnings", "agntux-slack", "sync.md");
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: filePath,
        content: syncMd({ cursor: "{not-json}", discoveryTs: "200.0" }),
      },
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/cursor.*JSON object/i);
  });

  it("rejects when discovery_ts regresses", () => {
    const filePath = syncFile(homeRoot, syncMd({ cursor: '{"C01":"100.0"}', discoveryTs: "200.0" }));
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: filePath,
        content: syncMd({ cursor: '{"C01":"200.0"}', discoveryTs: "150.0" }),
      },
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/discovery_ts regressed/);
  });

  it("rejects when a prior cursor key silently disappears", () => {
    const filePath = syncFile(homeRoot, syncMd({
      cursor: '{"C01":"100.0","C02":"50.0"}',
      discoveryTs: "100.0",
    }));
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: filePath,
        // Drops C02 with no eviction marker in errors.
        content: syncMd({ cursor: '{"C01":"100.0"}', discoveryTs: "200.0" }),
      },
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/silently dropped/);
    expect(result.stderr).toMatch(/C02/);
  });

  it("passes a key drop when the errors block carries an `evicted` marker", () => {
    const filePath = syncFile(homeRoot, syncMd({
      cursor: '{"C01":"100.0","C01#thread.0":"100.0"}',
      discoveryTs: "100.0",
    }));
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: filePath,
        content: syncMd({
          cursor: '{"C01":"200.0"}',
          discoveryTs: "200.0",
          errors: "  - kind: debug at 2026-05-07T14:00:00Z — slack-thread-evicted C01#thread.0 dormant > 30 days",
        }),
      },
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("rejects when a previously-non-null cursor key regresses to null", () => {
    const filePath = syncFile(homeRoot, syncMd({
      cursor: '{"C01":"100.0"}',
      discoveryTs: "100.0",
    }));
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: filePath,
        content: syncMd({ cursor: '{"C01":null}', discoveryTs: "100.0" }),
      },
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/regressed.*null/);
    expect(result.stderr).toMatch(/C01/);
  });

  it("passes when discovery_ts goes from null to a value (bootstrap → incremental)", () => {
    const filePath = syncFile(homeRoot, syncMd({
      cursor: '{}',
      discoveryTs: "null",
    }));
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: filePath,
        content: syncMd({ cursor: '{"C01":"100.0"}', discoveryTs: "100.0" }),
      },
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("ignores Edit tools whose new_string + old_string can't reconstruct the post-write content", () => {
    // Defensive: when we can't compute the new content, the hook bails open.
    const filePath = syncFile(homeRoot, syncMd({ cursor: '{"C01":"100.0"}', discoveryTs: "100.0" }));
    const result = runHook({
      tool_name: "Edit",
      tool_input: {
        file_path: filePath,
        // Missing new_string entirely — readPostWriteContent returns null.
        old_string: "anything",
      },
    }, homeRoot);
    expect(result.code).toBe(0);
  });
});

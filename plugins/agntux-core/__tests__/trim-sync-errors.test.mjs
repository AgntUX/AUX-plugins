// trim-sync-errors hook unit tests.
// PostToolUse hook — runs after a Write/Edit settles on disk. We seed the
// post-write file content, invoke the hook, then re-read the file to
// assert what was kept.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../hooks/trim-sync-errors.mjs", import.meta.url).pathname;

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
  const home = mkdtempSync(join(tmpdir(), "trim-sync-errors-"));
  mkdirSync(join(home, "agntux", "data", "learnings", "agntux-slack"), { recursive: true });
  return home;
}

function syncMd(errors) {
  // errors: array of one-line entry strings (without leading "  - ").
  const block = errors.length > 0
    ? errors.map((e) => `  - ${e}`).join("\n")
    : "  - (none)";
  return `---
type: plugin-sync-state
plugin_slug: agntux-slack
---

# agntux-slack — sync state

- cursor: {}
- discovery_ts: null
- last_run: null
- last_success: null
- items_processed: 0
- errors:
${block}
- lock: null
`;
}

function writeSync(homeRoot, content) {
  const path = join(homeRoot, "agntux", "data", "learnings", "agntux-slack", "sync.md");
  writeFileSync(path, content);
  return path;
}

function entryLineCount(content) {
  return content.split("\n").filter((line) => line.startsWith("  - kind:")).length;
}

describe("trim-sync-errors hook", () => {
  let homeRoot;

  beforeEach(() => {
    homeRoot = setupAgntuxRoot();
  });

  afterEach(() => {
    if (homeRoot) rmSync(homeRoot, { recursive: true, force: true });
  });

  it("passes through paths outside data/learnings/*/sync.md", () => {
    const filePath = join(homeRoot, "agntux", "user.md");
    writeFileSync(filePath, "---\ntype: user-config\n---\n");
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath },
    }, homeRoot);
    expect(result.code).toBe(0);
    // Untouched.
    expect(readFileSync(filePath, "utf8")).toBe("---\ntype: user-config\n---\n");
  });

  it("no-op when errors list has the (none) placeholder", () => {
    const filePath = writeSync(homeRoot, syncMd([]));
    const before = readFileSync(filePath, "utf8");
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath },
    }, homeRoot);
    expect(result.code).toBe(0);
    expect(readFileSync(filePath, "utf8")).toBe(before);
  });

  it("no-op when errors list has ≤ 10 entries", () => {
    const entries = Array.from({ length: 7 }, (_, i) => `kind: debug at 2026-05-07T${String(i).padStart(2, "0")}:00:00Z — entry ${i}`);
    const filePath = writeSync(homeRoot, syncMd(entries));
    const before = readFileSync(filePath, "utf8");
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath },
    }, homeRoot);
    expect(result.code).toBe(0);
    // Idempotency guarantee: byte-for-byte unchanged.
    expect(readFileSync(filePath, "utf8")).toBe(before);
  });

  it("no-op at exactly 10 entries (boundary)", () => {
    const entries = Array.from({ length: 10 }, (_, i) => `kind: debug at 2026-05-07T${String(i).padStart(2, "0")}:00:00Z — entry ${i}`);
    const filePath = writeSync(homeRoot, syncMd(entries));
    const before = readFileSync(filePath, "utf8");
    runHook({ tool_name: "Write", tool_input: { file_path: filePath } }, homeRoot);
    expect(readFileSync(filePath, "utf8")).toBe(before);
  });

  it("trims to 10 newest when errors list has 12 entries", () => {
    // Newest at top is the convention the skills emit.
    const entries = Array.from({ length: 12 }, (_, i) => `kind: debug at 2026-05-07T${String(i).padStart(2, "0")}:00:00Z — entry ${i}`);
    const filePath = writeSync(homeRoot, syncMd(entries));
    runHook({ tool_name: "Write", tool_input: { file_path: filePath } }, homeRoot);
    const after = readFileSync(filePath, "utf8");
    expect(entryLineCount(after)).toBe(10);
    // Newest 10 kept (entries 0..9), oldest 2 (entries 10, 11) dropped.
    expect(after).toContain("entry 0");
    expect(after).toContain("entry 9");
    expect(after).not.toContain("entry 10");
    expect(after).not.toContain("entry 11");
    // Surrounding fields preserved.
    expect(after).toContain("- lock: null");
    expect(after).toContain("- cursor: {}");
  });

  it("is idempotent on repeated runs (already-trimmed → no further change)", () => {
    const entries = Array.from({ length: 15 }, (_, i) => `kind: debug at 2026-05-07T${String(i).padStart(2, "0")}:00:00Z — entry ${i}`);
    const filePath = writeSync(homeRoot, syncMd(entries));
    runHook({ tool_name: "Write", tool_input: { file_path: filePath } }, homeRoot);
    const afterFirst = readFileSync(filePath, "utf8");
    runHook({ tool_name: "Write", tool_input: { file_path: filePath } }, homeRoot);
    const afterSecond = readFileSync(filePath, "utf8");
    expect(afterSecond).toBe(afterFirst);
    expect(entryLineCount(afterSecond)).toBe(10);
  });

  it("no-op when sync.md has no errors block at all", () => {
    const content = `---
type: plugin-sync-state
---

# agntux-slack
- cursor: {}
- lock: null
`;
    const filePath = writeSync(homeRoot, content);
    const before = readFileSync(filePath, "utf8");
    runHook({ tool_name: "Write", tool_input: { file_path: filePath } }, homeRoot);
    expect(readFileSync(filePath, "utf8")).toBe(before);
  });

  it("does not touch unrelated lines around the errors block", () => {
    const entries = Array.from({ length: 11 }, (_, i) => `kind: debug at t${i} — entry ${i}`);
    const content = syncMd(entries).replace(
      "- last_run: null",
      "- last_run: 2026-05-07T13:00:00Z"
    ).replace(
      "- items_processed: 0",
      "- items_processed: 999"
    );
    const filePath = writeSync(homeRoot, content);
    runHook({ tool_name: "Write", tool_input: { file_path: filePath } }, homeRoot);
    const after = readFileSync(filePath, "utf8");
    expect(after).toContain("- last_run: 2026-05-07T13:00:00Z");
    expect(after).toContain("- items_processed: 999");
    expect(after).toContain("- lock: null");
    expect(entryLineCount(after)).toBe(10);
  });
});

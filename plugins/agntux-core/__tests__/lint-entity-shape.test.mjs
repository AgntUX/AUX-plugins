// lint-entity-shape hook unit tests.
// PreToolUse hook, NON-BLOCKING — exits 0 even when the deprecated
// section name is present, but emits an imperative reminder on stdout
// so the agent renames the section in the same write before completing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../hooks/lint-entity-shape.mjs", import.meta.url).pathname;

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
  const home = mkdtempSync(join(tmpdir(), "lint-entity-shape-"));
  mkdirSync(join(home, "agntux", "entities", "person"), { recursive: true });
  mkdirSync(join(home, "agntux", "actions"), { recursive: true });
  return home;
}

function entityWith(section) {
  return `---
id: alice
type: entity
schema_version: "1.1.0"
subtype: person
---

## Summary
A person.

## Key Facts

${section}

## User notes
`;
}

describe("lint-entity-shape hook", () => {
  let homeRoot;

  beforeEach(() => {
    homeRoot = setupAgntuxRoot();
  });

  afterEach(() => {
    if (homeRoot) rmSync(homeRoot, { recursive: true, force: true });
  });

  it("passes silently when entity uses the canonical `## Recent signals`", () => {
    const filePath = join(homeRoot, "agntux", "entities", "person", "alice.md");
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: entityWith("## Recent signals") },
    }, homeRoot);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("emits imperative reminder when entity has the deprecated `## Recent Activity`", () => {
    const filePath = join(homeRoot, "agntux", "entities", "person", "alice.md");
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: entityWith("## Recent Activity") },
    }, homeRoot);
    // Non-blocking — exit 0 — write proceeds.
    expect(result.code).toBe(0);
    // Imperative voice; mentions the canonical replacement.
    expect(result.stdout).toContain("Rename");
    expect(result.stdout).toContain("## Recent Activity");
    expect(result.stdout).toContain("## Recent signals");
    expect(result.stdout).toContain("alice.md");
    // Don't finish the run with the deprecated name in place — the imperative.
    expect(result.stdout).toContain("do not finish this run with the deprecated name in place");
  });

  it("passes silently for files outside entities/", () => {
    const filePath = join(homeRoot, "agntux", "actions", "2026-05-07-x.md");
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: "## Recent Activity\n" },
    }, homeRoot);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("ignores _index.md writes (hook territory)", () => {
    const filePath = join(homeRoot, "agntux", "entities", "person", "_index.md");
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: "## Recent Activity\n" },
    }, homeRoot);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("does not match `## Recent Activity` when it appears mid-line (e.g., in inline code)", () => {
    // The lint matches whole-line section headers only; references to
    // the deprecated name in body prose / inline backticks are fine.
    const filePath = join(homeRoot, "agntux", "entities", "person", "alice.md");
    const content = entityWith(
      "## Recent signals\n\nThe section was previously called `## Recent Activity` in older docs."
    );
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content },
    }, homeRoot);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("an Edit that introduces the deprecated header into a clean file fires the lint", () => {
    const filePath = join(homeRoot, "agntux", "entities", "person", "alice.md");
    writeFileSync(filePath, entityWith("## Recent signals"));
    const result = runHook({
      tool_name: "Edit",
      tool_input: {
        file_path: filePath,
        old_string: "## Recent signals",
        new_string: "## Recent Activity",
      },
    }, homeRoot);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Rename");
    expect(result.stdout).toContain("alice.md");
  });
});

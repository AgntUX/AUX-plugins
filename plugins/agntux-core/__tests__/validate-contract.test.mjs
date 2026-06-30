// Contract-validator hook unit tests — Plan §1.D.2.
// Drives ../hooks/validate-contract.mjs as a child process with synthetic
// hook context payloads. Asserts blocking semantics on broken contract
// authoring patterns: exit 2 on reject, exit 0 on pass.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../hooks/validate-contract.mjs", import.meta.url).pathname;

function runHook(ctx, agntuxRoot) {
  const result = spawnSync("node", [HOOK], {
    input: JSON.stringify(ctx),
    env: { ...process.env, HOME: agntuxRoot },
    encoding: "utf8",
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function setupAgntuxRoot() {
  const home = mkdtempSync(join(tmpdir(), "p3a-contract-validator-"));
  mkdirSync(join(home, "agntux", "data", "schema", "contracts"), {
    recursive: true,
  });
  return home;
}

const VALID_LOCK = {
  schema_version: "1.0.0",
  generated_at: "2026-04-29T00:00:00Z",
  entity_subtypes: ["person", "company", "project", "topic"],
  action_classes: [
    "deadline",
    "response-needed",
    "knowledge-update",
    "risk",
    "opportunity",
    "other",
    "production-incident",
    "feature-shipped",
    "partner-signal",
    "deal-movement",
    "eng-blocker",
  ],
  plugin_contracts: {},
  checksum: "sha256:UNCOMPUTED",
};

function writeLock(homeRoot, lock) {
  const path = join(homeRoot, "agntux", "data", "schema", "schema.lock.json");
  writeFileSync(path, JSON.stringify(lock, null, 2));
}

const FRONTMATTER = [
  "---",
  "type: plugin-contract",
  "plugin_slug: agntux-slack",
  'schema_version: "1.0.0"',
  "---",
  "",
  "# agntux-slack — plugin contract",
  "",
].join("\n");

describe("validate-contract hook", () => {
  let homeRoot;

  beforeEach(() => {
    homeRoot = setupAgntuxRoot();
  });
  afterEach(() => {
    if (homeRoot) rmSync(homeRoot, { recursive: true, force: true });
  });

  it("passes when path is outside data/schema/contracts/", () => {
    writeLock(homeRoot, VALID_LOCK);
    const result = runHook(
      {
        tool_name: "Write",
        tool_input: {
          file_path: join(homeRoot, "agntux", "user.md"),
          content: "## reason_class additions\n\nFor **`response-needed`**:\n- `dm`",
        },
      },
      homeRoot,
    );
    expect(result.code).toBe(0);
  });

  it("passes a contract with the correct framing", () => {
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(
      homeRoot,
      "agntux",
      "data",
      "schema",
      "contracts",
      "agntux-slack.md",
    );
    const body = [
      FRONTMATTER,
      "## reason_class enum",
      "",
      "`reason_class` carries the canonical action_class enum. Values:",
      "",
      "- `deadline`, `response-needed`, `knowledge-update`, `risk`,",
      "  `opportunity`, `other`",
      "- `partner-signal`, `deal-movement`, `feature-shipped`,",
      "  `production-incident`, `eng-blocker`",
      "",
      "## reason_detail prefixes",
      "",
      "For **`response-needed`**:",
      "",
      "- `[dm]` — direct DM to the user.",
      "- `[mention]` — @-mention.",
      "",
    ].join("\n");
    const result = runHook(
      {
        tool_name: "Write",
        tool_input: { file_path: filePath, content: body },
      },
      homeRoot,
    );
    expect(result.code).toBe(0);
  });

  it("rejects a contract with `## reason_class additions` header", () => {
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(
      homeRoot,
      "agntux",
      "data",
      "schema",
      "contracts",
      "agntux-slack.md",
    );
    const body = [
      FRONTMATTER,
      "## reason_class additions",
      "",
      "For **`response-needed`**:",
      "",
      "- `dm` — direct DM to the user.",
      "- `mention` — @-mention of the user in a channel.",
      "",
    ].join("\n");
    const result = runHook(
      {
        tool_name: "Write",
        tool_input: { file_path: filePath, content: body },
      },
      homeRoot,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/reason_class additions/);
    expect(result.stderr).toMatch(/reason_detail prefixes/);
  });

  it("rejects when `## reason_class enum` lists a value not in lock.action_classes", () => {
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(
      homeRoot,
      "agntux",
      "data",
      "schema",
      "contracts",
      "agntux-slack.md",
    );
    const body = [
      FRONTMATTER,
      "## reason_class enum",
      "",
      "Values: `deadline`, `response-needed`, `nps-comment`, `risk`.",
      "",
    ].join("\n");
    const result = runHook(
      {
        tool_name: "Write",
        tool_input: { file_path: filePath, content: body },
      },
      homeRoot,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/nps-comment/);
  });

  it("flags value-by-action_class shape under a renamed reason_class header", () => {
    // Rule 3: a renamed header like `## reason_class extras` with the same
    // broken shape underneath should still be caught.
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(
      homeRoot,
      "agntux",
      "data",
      "schema",
      "contracts",
      "agntux-slack.md",
    );
    const body = [
      FRONTMATTER,
      "## reason_class extras",
      "",
      "For **`response-needed`**:",
      "",
      "- `dm` — direct DM to the user.",
      "",
    ].join("\n");
    const result = runHook(
      {
        tool_name: "Write",
        tool_input: { file_path: filePath, content: body },
      },
      homeRoot,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/value-by-action_class/);
  });

  it("ignores fenced code-block examples of the broken framing", () => {
    // The data-architect prompt itself documents the broken framing inside a
    // code fence as a NEGATIVE example. A future rewrite of the agent prompt
    // would land in agents/, not contracts/, so this is mostly belt-and-braces
    // — but a contract that quotes the bad pattern in a fence shouldn't be
    // blocked by it.
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(
      homeRoot,
      "agntux",
      "data",
      "schema",
      "contracts",
      "agntux-slack.md",
    );
    const body = [
      FRONTMATTER,
      "## reason_detail prefixes",
      "",
      "Note: a previous draft used a `## reason_class additions` section",
      "shaped like the example below. Don't do this:",
      "",
      "```",
      "## reason_class additions",
      "",
      "For **`response-needed`**:",
      "- `dm`",
      "```",
      "",
      "Use the `[dm]` prefix in `reason_detail` instead.",
      "",
    ].join("\n");
    const result = runHook(
      {
        tool_name: "Write",
        tool_input: { file_path: filePath, content: body },
      },
      homeRoot,
    );
    expect(result.code).toBe(0);
  });

  it("passes pre-bootstrap (no schema.lock.json)", () => {
    // No lock written. A contract with the correct framing should still pass.
    const filePath = join(
      homeRoot,
      "agntux",
      "data",
      "schema",
      "contracts",
      "agntux-slack.md",
    );
    const body = [
      FRONTMATTER,
      "## reason_class enum",
      "",
      "Values: `deadline`, `response-needed`.",
      "",
    ].join("\n");
    const result = runHook(
      {
        tool_name: "Write",
        tool_input: { file_path: filePath, content: body },
      },
      homeRoot,
    );
    expect(result.code).toBe(0);
  });

  it("Edit: introducing the broken header in an existing contract is rejected", () => {
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(
      homeRoot,
      "agntux",
      "data",
      "schema",
      "contracts",
      "agntux-slack.md",
    );
    const original = [
      FRONTMATTER,
      "## reason_detail prefixes",
      "",
      "For **`response-needed`**: `[dm]`, `[mention]`.",
      "",
    ].join("\n");
    writeFileSync(filePath, original);
    const result = runHook(
      {
        tool_name: "Edit",
        tool_input: {
          file_path: filePath,
          old_string: "## reason_detail prefixes",
          new_string: "## reason_class additions",
        },
      },
      homeRoot,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/reason_class additions/);
  });
});

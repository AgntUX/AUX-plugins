// validate-team-write-lane.mjs unit tests.
// Drives the hook as a child process with synthetic stdin, asserts exit
// codes. Mirrors agntux-core's validate-write-lane.test.mjs.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../hooks/validate-team-write-lane.mjs", import.meta.url)
  .pathname;

function runHook(ctx, homeRoot, pluginName) {
  const env = { ...process.env, HOME: homeRoot };
  if (pluginName) env.CLAUDE_PLUGIN_NAME = pluginName;
  else delete env.CLAUDE_PLUGIN_NAME;
  const result = spawnSync("node", [HOOK], {
    input: JSON.stringify(ctx),
    env,
    encoding: "utf8",
    cwd: homeRoot,
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function setupRoot() {
  const home = mkdtempSync(join(tmpdir(), "validate-team-write-lane-"));
  mkdirSync(join(home, "agntux", "teams", "platform", "data"), {
    recursive: true,
  });
  mkdirSync(join(home, "agntux", "teams", "platform", "entities"), {
    recursive: true,
  });
  mkdirSync(join(home, "agntux", "teams", "platform", "actions"), {
    recursive: true,
  });
  mkdirSync(join(home, "agntux", "teams", "infra", "data"), { recursive: true });
  mkdirSync(
    join(home, "agntux", "leader-views", "all-engineering", "actions"),
    { recursive: true },
  );
  return home;
}

function writeTeamConfig(home, teamSlug, authorizedPlugins) {
  const path = join(home, "agntux", "teams", teamSlug, "data", "team-config.md");
  writeFileSync(
    path,
    [
      "---",
      `team_slug: ${teamSlug}`,
      "display_name: Platform Team",
      "cadence: 60m",
      "schema_version: 1.0.0",
      "onboarding_complete: true",
      "authorized_plugins:",
      ...authorizedPlugins.map((p) => `  - ${p}`),
      "---",
      "",
    ].join("\n"),
  );
}

function ctxWrite(filePath) {
  return {
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "irrelevant" },
  };
}

describe("validate-team-write-lane", () => {
  let home;

  beforeEach(() => {
    home = setupRoot();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("passes (exit 0) for paths outside teams/ and leader-views/", () => {
    const r = runHook(
      ctxWrite(join(home, "agntux", "entities", "people", "alice.md")),
      home,
      "agntux-slack",
    );
    expect(r.code).toBe(0);
  });

  it("passes when CLAUDE_PLUGIN_NAME is missing (manual user edit)", () => {
    writeTeamConfig(home, "platform", ["agntux-teams"]);
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "actions", "x.md"),
      ),
      home,
      null,
    );
    expect(r.code).toBe(0);
  });

  it("passes for an authorized plugin writing under teams/{slug}/", () => {
    writeTeamConfig(home, "platform", ["agntux-teams", "agntux-slack"]);
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "actions", "x.md"),
      ),
      home,
      "agntux-slack",
    );
    expect(r.code).toBe(0);
  });

  it("rejects (exit 2) for an unauthorized plugin writing under teams/{slug}/", () => {
    writeTeamConfig(home, "platform", ["agntux-teams"]);
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "actions", "x.md"),
      ),
      home,
      "agntux-gmail",
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/agntux-gmail/);
    expect(r.stderr).toMatch(/platform/);
  });

  it("rejects when team-config.md is missing AND writer is not agntux-teams", () => {
    // No team-config.md written.
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "infra", "entities", "thing.md"),
      ),
      home,
      "agntux-slack",
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/team-config.md/);
  });

  it("passes when team-config.md is missing AND writer IS agntux-teams (onboarding)", () => {
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "infra", "data", "team-config.md"),
      ),
      home,
      "agntux-teams",
    );
    expect(r.code).toBe(0);
  });

  it("passes for hook-owned _index.md regardless of writer", () => {
    writeTeamConfig(home, "platform", ["agntux-teams"]);
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "actions", "_index.md"),
      ),
      home,
      "agntux-anything",
    );
    expect(r.code).toBe(0);
  });

  it("passes for hook-owned _sources.json regardless of writer", () => {
    writeTeamConfig(home, "platform", ["agntux-teams"]);
    const r = runHook(
      ctxWrite(
        join(home, "agntux", "teams", "platform", "entities", "_sources.json"),
      ),
      home,
      "agntux-anything",
    );
    expect(r.code).toBe(0);
  });

  it("rejects any plugin other than agntux-teams writing under leader-views/", () => {
    const r = runHook(
      ctxWrite(
        join(
          home,
          "agntux",
          "leader-views",
          "all-engineering",
          "actions",
          "x.md",
        ),
      ),
      home,
      "agntux-slack",
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/leader-views/);
  });

  it("passes for agntux-teams writing under leader-views/", () => {
    const r = runHook(
      ctxWrite(
        join(
          home,
          "agntux",
          "leader-views",
          "all-engineering",
          "actions",
          "x.md",
        ),
      ),
      home,
      "agntux-teams",
    );
    expect(r.code).toBe(0);
  });

  it("ignores non-Write/Edit tool calls", () => {
    const ctx = { tool_name: "Bash", tool_input: { command: "ls" } };
    const r = runHook(ctx, home, "agntux-slack");
    expect(r.code).toBe(0);
  });
});

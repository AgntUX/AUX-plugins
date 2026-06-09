/**
 * view-tool-connector-calls.test.ts
 *
 * Unit tests for pass 17 (E32) — a view-tool component must not call a
 * host/connector tool by a hard-coded `mcp__…` name. Connector writes go
 * through `client.sendFollowUpMessage(envelope)`. The plugin's own
 * `mcp__agntux…` action-mutation tools are allowed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass17ViewToolConnectorCalls } from "../lint-view-tool-connector-calls.js";
import type { Finding } from "../lint-view-tool-connector-calls.js";

interface Tmp {
  repoRoot: string;
  pluginDir: string;
}

function mkTmpPlugin(slug: string): Tmp {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint17-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(path.join(pluginDir, "view-tool", "src", "components"), {
    recursive: true,
  });
  return { repoRoot, pluginDir };
}

function writeSrc(tmp: Tmp, relPath: string, body: string): void {
  const abs = path.join(tmp.pluginDir, "view-tool", "src", relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function run(tmp: Tmp, slug: string): Finding[] {
  const findings: Finding[] = [];
  pass17ViewToolConnectorCalls(slug, tmp.pluginDir, tmp.repoRoot, findings);
  return findings;
}

describe("pass17ViewToolConnectorCalls", () => {
  let tmp: Tmp | null = null;

  beforeEach(() => {
    tmp = null;
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true });
  });

  it("flags E32 for a hard-coded mcp__claude_ai connector callTool", () => {
    tmp = mkTmpPlugin("claude-ai");
    writeSrc(
      tmp,
      "components/card.tsx",
      `export async function go(client) {\n  await client.callTool('mcp__claude_ai_Google_Calendar__create_event', { summary });\n}\n`,
    );
    const findings = run(tmp, "claude-ai");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E32");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.line).toBe(2);
  });

  it("flags E32 for a UUID-prefixed connector callTool", () => {
    tmp = mkTmpPlugin("uuid");
    writeSrc(
      tmp,
      "components/card.tsx",
      `await client.callTool("mcp__6c79477b-8aba-4a80-a908-d368831392cf__suggest_time", {});\n`,
    );
    const findings = run(tmp, "uuid");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E32");
  });

  it("does NOT flag the plugin's own mcp__agntux action-mutation tools", () => {
    tmp = mkTmpPlugin("own");
    writeSrc(
      tmp,
      "components/card.tsx",
      `await client.callTool('mcp__agntux-core__agntux_core_set_status', { action_id, status });\n`,
    );
    expect(run(tmp, "own")).toEqual([]);
  });

  it("does NOT flag sendFollowUpMessage dispatch (the correct pattern)", () => {
    tmp = mkTmpPlugin("good");
    writeSrc(
      tmp,
      "components/card.tsx",
      `await client.sendFollowUpMessage(envelope);\n`,
    );
    expect(run(tmp, "good")).toEqual([]);
  });

  it("does NOT flag a connector tool name that appears only in a comment", () => {
    tmp = mkTmpPlugin("comment");
    writeSrc(
      tmp,
      "components/card.tsx",
      `// do NOT client.callTool('mcp__claude_ai_Google_Calendar__create_event')\nawait client.sendFollowUpMessage(envelope);\n`,
    );
    expect(run(tmp, "comment")).toEqual([]);
  });

  it("ignores lib/ and __tests__/", () => {
    tmp = mkTmpPlugin("excluded");
    writeSrc(
      tmp,
      "lib/apps-client/adapters/mcp.ts",
      `await this.app.callTool('mcp__claude_ai_x__y', {});\n`,
    );
    writeSrc(
      tmp,
      "__tests__/card.test.tsx",
      `client.callTool('mcp__claude_ai_x__y', {});\n`,
    );
    expect(run(tmp, "excluded")).toEqual([]);
  });

  it("stays silent when the plugin has no view-tool/src/ directory", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint17-nodir-"));
    const pluginDir = path.join(repoRoot, "plugins", "no-view");
    fs.mkdirSync(pluginDir, { recursive: true });
    tmp = { repoRoot, pluginDir };
    expect(run(tmp, "no-view")).toEqual([]);
  });
});

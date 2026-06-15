/**
 * host-prompt-slash.test.ts
 *
 * Unit tests for pass 18 (E33) — no slash-command host prompts. Programmatic
 * prompts (sendFollowUpMessage args, suggested-action host_prompt values, and
 * view-tool description trigger phrases) must be natural-language descriptions
 * ("Use the <slug> plugin to …"), never slash commands, which the host can't
 * route when sent programmatically.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass18HostPromptSlash } from "../lint-host-prompt-slash.js";
import type { Finding } from "../lint-host-prompt-slash.js";

interface Tmp {
  repoRoot: string;
  pluginDir: string;
  slug: string;
}

function mkTmpPlugin(slug: string): Tmp {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint18-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(pluginDir, { recursive: true });
  return { repoRoot, pluginDir, slug };
}

function writeSrc(tmp: Tmp, relPath: string, body: string): void {
  const abs = path.join(tmp.pluginDir, "view-tool", "src", relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function writeSkill(tmp: Tmp, relPath: string, body: string): void {
  const abs = path.join(tmp.pluginDir, "skills", tmp.slug, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function run(tmp: Tmp): Finding[] {
  const findings: Finding[] = [];
  pass18HostPromptSlash(tmp.slug, tmp.pluginDir, tmp.repoRoot, findings);
  return findings;
}

describe("pass18HostPromptSlash", () => {
  let tmp: Tmp | null = null;

  beforeEach(() => {
    tmp = null;
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true });
  });

  it("flags E33 for a slash literal passed to sendFollowUpMessage", () => {
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(
      tmp,
      "components/card.tsx",
      `export function go() {\n  void sendFollowUpMessage('/agntux onboard');\n}\n`,
    );
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E33");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.line).toBe(2);
  });

  it("flags E33 for a hyphenated plugin-slug slash trigger phrase in a description", () => {
    tmp = mkTmpPlugin("agntux-slack");
    writeSrc(
      tmp,
      "agntux-slack-view.ts",
      'const d = { description: "Trigger phrases: `/agntux-slack open the reply composer for action {id}`." };\n',
    );
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E33");
  });

  it("flags E33 for a slash host_prompt: value in a skills markdown file", () => {
    tmp = mkTmpPlugin("agntux-jira");
    writeSkill(
      tmp,
      "reference/compose-payload.md",
      'suggested_actions:\n  - label: "Draft"\n    host_prompt: "/agntux-jira open the comment composer for action {id}"\n',
    );
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E33");
    expect(findings[0]?.file).toContain("compose-payload.md");
  });

  it("does NOT flag the natural-language form", () => {
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(
      tmp,
      "components/card.tsx",
      `void sendFollowUpMessage('Use the agntux-core plugin to start onboarding');\n`,
    );
    writeSkill(
      tmp,
      "reference/compose-payload.md",
      '    host_prompt: "Use the agntux-jira plugin to open the comment composer for action {id}"\n',
    );
    expect(run(tmp)).toEqual([]);
  });

  it("does NOT flag a ui:// resource URI (mid-string slash)", () => {
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(
      tmp,
      "agntux-core-view.ts",
      'const TRIAGE_RESOURCE_URI = "ui://agntux-core/triage" as const;\n',
    );
    expect(run(tmp)).toEqual([]);
  });

  it("does NOT flag a bare `/agntux triage` user-typed-command reference in a description", () => {
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(
      tmp,
      "agntux-core-view.ts",
      'const d = { description: "Use when the user types `/agntux triage`, or asks to show triage." };\n',
    );
    expect(run(tmp)).toEqual([]);
  });

  it("does NOT flag a slash mentioned only in a comment", () => {
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(
      tmp,
      "components/card.tsx",
      `// legacy: sendFollowUpMessage('/agntux-slack open the reply composer')\nvoid sendFollowUpMessage(envelope);\n`,
    );
    expect(run(tmp)).toEqual([]);
  });

  it("does NOT flag user-typed-command prose in skills markdown (only host_prompt: values)", () => {
    tmp = mkTmpPlugin("agntux-gmail");
    writeSkill(
      tmp,
      "reference/runbook.md",
      "User runs `/agntux onboard`, which fires `/agntux-gmail` with the cursor.\n",
    );
    expect(run(tmp)).toEqual([]);
  });

  it("ignores lib/ and __tests__/", () => {
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(
      tmp,
      "lib/x.ts",
      `void sendFollowUpMessage('/agntux onboard');\n`,
    );
    writeSrc(
      tmp,
      "__tests__/card.test.tsx",
      `void sendFollowUpMessage('/agntux onboard');\n`,
    );
    expect(run(tmp)).toEqual([]);
  });

  it("flags E33 for an UNQUOTED host_prompt: slash value (hand-authored shape)", () => {
    tmp = mkTmpPlugin("agntux-jira");
    writeSkill(
      tmp,
      "reference/compose-payload.md",
      "    host_prompt: /agntux-jira open the comment composer for action {id}\n",
    );
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E33");
  });

  it("flags E33 for a host_prompt: slash value with a leading space", () => {
    tmp = mkTmpPlugin("agntux-jira");
    writeSkill(
      tmp,
      "reference/compose-payload.md",
      '    host_prompt: " /agntux-jira do the thing for action {id}"\n',
    );
    expect(run(tmp)).toHaveLength(1);
  });

  it("does NOT flag a host_prompt: mention in doc prose (key not at line start)", () => {
    tmp = mkTmpPlugin("agntux-jira");
    writeSkill(
      tmp,
      "reference/runbook.md",
      'The host_prompt: "/agntux-jira …" slash form is wrong; never hand-author it.\n',
    );
    expect(run(tmp)).toEqual([]);
  });

  it("flags E33 for a multiline sendFollowUpMessage slash argument", () => {
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(
      tmp,
      "components/card.tsx",
      "export function go() {\n  void sendFollowUpMessage(\n    '/agntux onboard',\n  );\n}\n",
    );
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E33");
    // points at the sendFollowUpMessage call line, not the wrapped arg line.
    expect(findings[0]?.line).toBe(2);
  });

  it("stays silent when the plugin has neither view-tool/src nor skills", () => {
    tmp = mkTmpPlugin("empty");
    expect(run(tmp)).toEqual([]);
  });
});

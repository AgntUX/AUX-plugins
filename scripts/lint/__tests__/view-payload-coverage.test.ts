/**
 * view-payload-coverage.test.ts
 *
 * Unit tests for pass 19 (E34) — every `## <View> payload` section a view
 * handler reads must be written by the plugin's ingest skill (Step 10). A read
 * section absent from skills/<slug>/reference/sync.md means the action file
 * lacks it and the view renders an empty envelope.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass19ViewPayloadCoverage } from "../lint-view-payload-coverage.js";
import type { Finding } from "../lint-view-payload-coverage.js";

interface Tmp {
  repoRoot: string;
  pluginDir: string;
  slug: string;
}

function mkTmpPlugin(slug: string): Tmp {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint19-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(pluginDir, { recursive: true });
  return { repoRoot, pluginDir, slug };
}

function writeSrc(tmp: Tmp, relPath: string, body: string): void {
  const abs = path.join(tmp.pluginDir, "view-tool", "src", relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function writeSync(tmp: Tmp, body: string): void {
  const abs = path.join(
    tmp.pluginDir,
    "skills",
    tmp.slug,
    "reference",
    "sync.md",
  );
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function run(tmp: Tmp): Finding[] {
  const findings: Finding[] = [];
  pass19ViewPayloadCoverage(tmp.slug, tmp.pluginDir, tmp.repoRoot, findings);
  return findings;
}

describe("pass19ViewPayloadCoverage", () => {
  let tmp: Tmp | null = null;

  beforeEach(() => {
    tmp = null;
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true });
  });

  it("flags E34 when a read payload section is absent from sync.md", () => {
    tmp = mkTmpPlugin("agntux-google-calendar");
    writeSrc(
      tmp,
      "agntux-google-calendar-view.ts",
      `const raw = parseSectionYaml(body, "Respond payload");\n`,
    );
    writeSync(tmp, "## Step 10\n\nWrite `## Compose payload` for replies.\n");
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E34");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toContain("Respond payload");
  });

  it("does NOT flag when sync.md names the read section", () => {
    tmp = mkTmpPlugin("agntux-google-calendar");
    writeSrc(
      tmp,
      "agntux-google-calendar-view.ts",
      `const raw = parseSectionYaml(body, "Respond payload");\n` +
        `const raw2 = parseSectionYaml(body, "Schedule payload");\n`,
    );
    writeSync(
      tmp,
      "## Step 10\n\nWrite `## Respond payload` and `## Schedule payload`.\n",
    );
    expect(run(tmp)).toEqual([]);
  });

  it("flags each Jira payload section the skill fails to write", () => {
    tmp = mkTmpPlugin("agntux-jira");
    writeSrc(
      tmp,
      "agntux-jira-view.ts",
      `parseYamlSection(body, "Comment payload");\n` +
        `parseYamlSection(body, "Transition payload");\n` +
        `parseYamlSection(body, "Assign payload");\n`,
    );
    // sync.md mentions only Comment payload — Transition + Assign are gaps.
    writeSync(tmp, "Write `## Comment payload` when commenting.\n");
    const findings = run(tmp);
    expect(findings).toHaveLength(2);
    const names = findings.map((f) => f.message).join(" ");
    expect(names).toContain("Transition payload");
    expect(names).toContain("Assign payload");
  });

  it("does NOT flag non-payload sections read with the same helper", () => {
    tmp = mkTmpPlugin("agntux-jira");
    writeSrc(
      tmp,
      "agntux-jira-view.ts",
      `const prep = extractFencedYaml(body, "Meeting prep");\n`,
    );
    writeSync(tmp, "## Step 10\n\nNo payload sections here.\n");
    expect(run(tmp)).toEqual([]);
  });

  it("skips a plugin with a view-tool but no ingest sync.md (hub-only)", () => {
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(
      tmp,
      "agntux-core-view.ts",
      `const raw = extractFencedYaml(body, "Respond payload");\n`,
    );
    // no skills/<slug>/reference/sync.md
    expect(run(tmp)).toEqual([]);
  });

  it("stays silent when the plugin has no view-tool/src", () => {
    tmp = mkTmpPlugin("no-view");
    writeSync(tmp, "## Step 10\n");
    expect(run(tmp)).toEqual([]);
  });

  it("does NOT flag a section named only in a comment read line", () => {
    tmp = mkTmpPlugin("agntux-slack");
    writeSrc(
      tmp,
      "agntux-slack-view.ts",
      `// parseSectionYaml(body, "Canvas payload") legacy\n` +
        `const c = extractFencedYaml(body, "Compose payload");\n`,
    );
    writeSync(tmp, "Write `## Compose payload` for replies.\n");
    // Canvas payload only appears in a comment → not a real read → no E34.
    expect(run(tmp)).toEqual([]);
  });

  it("flags E34 when sync.md mentions the section only in prose (no `## ` heading)", () => {
    tmp = mkTmpPlugin("agntux-google-calendar");
    writeSrc(
      tmp,
      "view.ts",
      `const raw = parseSectionYaml(body, "Respond payload");\n`,
    );
    // mentions the words but never the `## Respond payload` write instruction.
    writeSync(tmp, "The respond payload is produced somewhere else.\n");
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E34");
  });

  it("does NOT flag when sync.md writes the heading in a different case", () => {
    tmp = mkTmpPlugin("agntux-google-calendar");
    writeSrc(
      tmp,
      "view.ts",
      `const raw = parseSectionYaml(body, "Respond payload");\n`,
    );
    writeSync(tmp, "Write `## respond PAYLOAD` for response-needed items.\n");
    expect(run(tmp)).toEqual([]);
  });

  it("resolves the ingest skill when the skill dir is not the plugin slug", () => {
    // agntux-core's skill lives at skills/agntux/, not skills/agntux-core/.
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(
      tmp,
      "agntux-core-view.ts",
      `const raw = extractFencedYaml(body, "Respond payload");\n`,
    );
    const abs = path.join(
      tmp.pluginDir,
      "skills",
      "agntux",
      "reference",
      "sync.md",
    );
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "Write `## Respond payload` for items.\n", "utf8");
    expect(run(tmp)).toEqual([]);
  });
});

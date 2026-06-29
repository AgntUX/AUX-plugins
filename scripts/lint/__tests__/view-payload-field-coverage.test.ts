/**
 * view-payload-field-coverage.test.ts
 *
 * Unit tests for pass 20 (E35) — every FIELD a view handler reads off an
 * on-disk payload object must be documented as written by the ingest skill.
 * Tightens pass 19 from heading-coverage to field-coverage (the apple-notes
 * class: view read `draft_body` but the generic schema wrote only `drafted_body`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass20ViewPayloadFieldCoverage } from "../lint-view-payload-field-coverage.js";
import type { Finding } from "../lint-view-payload-field-coverage.js";

interface Tmp {
  repoRoot: string;
  pluginDir: string;
  slug: string;
}

function mkTmpPlugin(slug: string): Tmp {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint20-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(pluginDir, { recursive: true });
  return { repoRoot, pluginDir, slug };
}

function writeSrc(tmp: Tmp, relPath: string, body: string): void {
  const abs = path.join(tmp.pluginDir, "view-tool", "src", relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

/** Writes both reference/sync.md AND _overrides/frontmatter.yaml (the guard). */
function writeSkill(tmp: Tmp, syncBody: string, refFiles: Record<string, string> = {}, skillDir = tmp.slug): void {
  const base = path.join(tmp.pluginDir, "skills", skillDir);
  const refDir = path.join(base, "reference");
  fs.mkdirSync(refDir, { recursive: true });
  fs.writeFileSync(path.join(refDir, "sync.md"), syncBody, "utf8");
  for (const [name, body] of Object.entries(refFiles)) {
    fs.writeFileSync(path.join(refDir, name), body, "utf8");
  }
  const ovDir = path.join(base, "_overrides");
  fs.mkdirSync(ovDir, { recursive: true });
  fs.writeFileSync(path.join(ovDir, "frontmatter.yaml"), "plugin-slug: x\n", "utf8");
}

function run(tmp: Tmp): Finding[] {
  const findings: Finding[] = [];
  pass20ViewPayloadFieldCoverage(tmp.slug, tmp.pluginDir, tmp.repoRoot, findings);
  return findings;
}

describe("pass20ViewPayloadFieldCoverage", () => {
  let tmp: Tmp | null = null;
  beforeEach(() => { tmp = null; });
  afterEach(() => { if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true }); });

  it("flags E35 (error) for a payload field the skill never documents", () => {
    tmp = mkTmpPlugin("agntux-apple-notes");
    writeSrc(
      tmp,
      "view.ts",
      `const cp = parseComposeSectionYaml(body);\n` +
        `const title = str(cp.draft_title);\n` +
        `const note = str(cp.draft_body);\n`,
    );
    // sync.md documents draft_body but NOT draft_title.
    writeSkill(tmp, "Write `## Compose payload` with draft_body for notes.\n");
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E35");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toContain("draft_title");
  });

  it("does NOT flag when every read field appears in a reference/*.md", () => {
    tmp = mkTmpPlugin("agntux-apple-notes");
    writeSrc(
      tmp,
      "view.ts",
      `const cp = parseComposeSectionYaml(body);\n` +
        `const t = str(cp.draft_title);\nconst b = str(cp.draft_body);\n`,
    );
    writeSkill(tmp, "## Step 10\n", {
      "compose-payload.md": "Fields: draft_title, draft_body, target_folder.\n",
    });
    expect(run(tmp)).toEqual([]);
  });

  it("collects destructured keys off the payload var", () => {
    tmp = mkTmpPlugin("agntux-dropbox");
    writeSrc(
      tmp,
      "view.ts",
      `const cp = parseYamlSection(body, "Compose payload");\n` +
        `const { file_path, suggested_access } = cp;\n`,
    );
    writeSkill(tmp, "Write `## Compose payload` with file_path only.\n");
    const findings = run(tmp);
    // suggested_access is undocumented → exactly one finding.
    expect(findings.map((f) => f.message).join(" ")).toContain("suggested_access");
    expect(findings.every((f) => f.code === "E35")).toBe(true);
  });

  it("handles the parsed.compose_payload assignment shape (gmail/slack runtime)", () => {
    tmp = mkTmpPlugin("agntux-gmail");
    writeSrc(
      tmp,
      "view.ts",
      `const onDisk = parsed.compose_payload;\n` +
        `const d = onDisk.drafted_body;\nconst r = onDisk.reply_to_message_id;\n`,
    );
    writeSkill(tmp, "Write `## Compose payload` with drafted_body.\n");
    const findings = run(tmp);
    expect(findings.map((f) => f.message).join(" ")).toContain("reply_to_message_id");
  });

  it("ignores standard ActionFrontmatter keys (read off the frontmatter, not the payload)", () => {
    tmp = mkTmpPlugin("agntux-jira");
    writeSrc(
      tmp,
      "view.ts",
      `const cp = parseYamlSection(body, "Comment payload");\n` +
        `const s = cp.status;\nconst p = cp.priority;\nconst id = cp.id;\n`,
    );
    writeSkill(tmp, "## Step 10 — no payload fields documented.\n");
    // status/priority/id are frontmatter keys → excluded → no findings.
    expect(run(tmp)).toEqual([]);
  });

  it("skips a hub-style skill that lacks _overrides/frontmatter.yaml", () => {
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(tmp, "view.ts", `const cp = parseYamlSection(body, "X payload");\nconst z = cp.zzz_field;\n`);
    // sync.md present but no _overrides/frontmatter.yaml → not a rendered ingest skill.
    const base = path.join(tmp.pluginDir, "skills", "agntux", "reference");
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, "sync.md"), "hub\n", "utf8");
    expect(run(tmp)).toEqual([]);
  });

  it("stays silent when there is no view-tool/src", () => {
    tmp = mkTmpPlugin("agntux-mercury");
    writeSkill(tmp, "## Step 10\n");
    expect(run(tmp)).toEqual([]);
  });

  it("does NOT collect fields when no payload variable is assigned", () => {
    tmp = mkTmpPlugin("agntux-asana");
    // reads off `args`/`meta`, not a parsed disk payload → out of scope for E35.
    writeSrc(tmp, "view.ts", `const t = args.task_gid;\nconst m = meta.payload.draft_body;\n`);
    writeSkill(tmp, "## Step 10\n");
    expect(run(tmp)).toEqual([]);
  });

  it("detects the annotated multi-line extractFrontmatterMetadata shape (notion/posthog)", () => {
    tmp = mkTmpPlugin("agntux-notion");
    // The real shape: `const fm: Record<string, unknown> =\n  extractFrontmatterMetadata(...) ?? {};`
    writeSrc(
      tmp,
      "view.ts",
      `const fm: Record<string, unknown> =\n` +
        `  extractFrontmatterMetadata(buf) ?? {};\n` +
        `const pid = fm.page_id;\nconst d = fm.draft_body;\n`,
    );
    // sync.md documents page_id but NOT draft_body → exactly one E35 for draft_body.
    writeSkill(tmp, "Write page_id into frontmatter metadata.\n");
    const findings = run(tmp);
    expect(findings.map((f) => f.message).join(" ")).toContain("draft_body");
    expect(findings.every((f) => f.code === "E35")).toBe(true);
  });

  it("detects a bespoke per-source parser name (slack parseSlackComposePayload)", () => {
    tmp = mkTmpPlugin("agntux-slack");
    writeSrc(
      tmp,
      "view.ts",
      `const onDisk = parseSlackComposePayload(body);\n` +
        `const c = onDisk.channel;\nconst d = onDisk.drafted_body;\n`,
    );
    // drafted_body documented, channel is not → one finding for channel.
    writeSkill(tmp, "## Step 10\n", {
      "compose-payload.md": "Write drafted_body for replies.\n",
    });
    const findings = run(tmp);
    expect(findings.map((f) => f.message).join(" ")).toContain("channel");
    expect(findings.map((f) => f.message).join(" ")).not.toContain("drafted_body");
  });
});

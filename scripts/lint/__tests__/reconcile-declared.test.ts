/**
 * reconcile-declared.test.ts
 *
 * Unit tests for pass 21 (E36) — every action-producing ingest plugin (ships a
 * view-tool AND a rendered ingest sync skill) must ship a non-empty
 * _overrides/step-reconcile-append.md declaring its Step 8.5 reconcile signals.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass21ReconcileDeclared } from "../lint-reconcile-declared.js";
import type { Finding } from "../lint-reconcile-declared.js";

interface Tmp {
  repoRoot: string;
  pluginDir: string;
  slug: string;
}

function mkTmpPlugin(slug: string): Tmp {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint21-${slug}-`));
  const pluginDir = path.join(repoRoot, "plugins", slug);
  fs.mkdirSync(pluginDir, { recursive: true });
  return { repoRoot, pluginDir, slug };
}

function withView(tmp: Tmp): void {
  const abs = path.join(tmp.pluginDir, "view-tool", "src", "view.ts");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "// view\n", "utf8");
}

/** Rendered ingest skill: reference/sync.md + _overrides/frontmatter.yaml. */
function withSkill(tmp: Tmp, opts: { reconcile?: string | null; skillDir?: string } = {}): void {
  const skillDir = opts.skillDir ?? tmp.slug;
  const base = path.join(tmp.pluginDir, "skills", skillDir);
  fs.mkdirSync(path.join(base, "reference"), { recursive: true });
  fs.writeFileSync(path.join(base, "reference", "sync.md"), "## Step 8.5\n", "utf8");
  const ov = path.join(base, "_overrides");
  fs.mkdirSync(ov, { recursive: true });
  fs.writeFileSync(path.join(ov, "frontmatter.yaml"), "plugin-slug: x\n", "utf8");
  if (opts.reconcile != null) {
    fs.writeFileSync(path.join(ov, "step-reconcile-append.md"), opts.reconcile, "utf8");
  }
}

function run(tmp: Tmp): Finding[] {
  const findings: Finding[] = [];
  pass21ReconcileDeclared(tmp.slug, tmp.pluginDir, tmp.repoRoot, findings);
  return findings;
}

describe("pass21ReconcileDeclared", () => {
  let tmp: Tmp | null = null;
  beforeEach(() => { tmp = null; });
  afterEach(() => { if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true }); });

  it("flags E36 (warning) when a view plugin ships no step-reconcile-append.md", () => {
    tmp = mkTmpPlugin("agntux-zoom");
    withView(tmp);
    withSkill(tmp, { reconcile: null });
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E36");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.file).toContain("step-reconcile-append.md");
  });

  it("does NOT flag when a non-empty step-reconcile-append.md exists", () => {
    tmp = mkTmpPlugin("agntux-jira");
    withView(tmp);
    withSkill(tmp, { reconcile: "- **Resolved when** — issue is Done.\n" });
    expect(run(tmp)).toEqual([]);
  });

  it("flags E36 when the append file exists but is whitespace-only", () => {
    tmp = mkTmpPlugin("agntux-stripe");
    withView(tmp);
    withSkill(tmp, { reconcile: "   \n\n" });
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E36");
  });

  it("skips a fetch-only plugin with no view-tool", () => {
    tmp = mkTmpPlugin("agntux-google-drive");
    // no view-tool/src
    withSkill(tmp, { reconcile: null });
    expect(run(tmp)).toEqual([]);
  });

  it("skips a hub skill that lacks _overrides/frontmatter.yaml", () => {
    tmp = mkTmpPlugin("agntux-core");
    withView(tmp);
    // sync.md but no _overrides/frontmatter.yaml → not a rendered ingest skill.
    const base = path.join(tmp.pluginDir, "skills", "agntux", "reference");
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, "sync.md"), "hub\n", "utf8");
    expect(run(tmp)).toEqual([]);
  });

  it("resolves the skill dir when it differs from the plugin slug", () => {
    tmp = mkTmpPlugin("agntux-apple-notes");
    withView(tmp);
    withSkill(tmp, { reconcile: "- **Resolved when** — note deleted.\n", skillDir: "agntux-apple-notes" });
    expect(run(tmp)).toEqual([]);
  });
});

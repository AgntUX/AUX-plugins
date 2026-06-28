/**
 * namespaced-compose-read.test.ts
 *
 * Unit tests for pass 22 (E37) — a view that reads an on-disk payload section
 * must ALSO read its own namespaced cross-source header
 * `## Compose payload (<slug>)`. The Step 9 cross-source merge writes the
 * plugin's payload under that namespaced header onto a sibling's action file;
 * a view that only reads its bare/per-view header renders blank for a merged
 * action (the agntux-google-calendar "Untitled event" class).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass22NamespacedComposeRead } from "../lint-namespaced-compose-read.js";
import type { Finding } from "../lint-namespaced-compose-read.js";

interface Tmp {
  repoRoot: string;
  pluginDir: string;
  slug: string;
}

function mkTmpPlugin(slug: string): Tmp {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lint22-${slug}-`));
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
  const abs = path.join(tmp.pluginDir, "skills", tmp.slug, "reference", "sync.md");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function run(tmp: Tmp): Finding[] {
  const findings: Finding[] = [];
  pass22NamespacedComposeRead(tmp.slug, tmp.pluginDir, tmp.repoRoot, findings);
  return findings;
}

// The cross-source-merge instruction as it actually appears in a rendered
// sync.md: an inline backticked mention inside a prose bullet, NOT a heading.
const MERGE_BULLET = (slug: string) =>
  `## Step 9\n\n- Append a \`## Compose payload (${slug})\` body section under a ` +
  `namespaced header so your view tool reads it without colliding.\n`;

describe("pass22NamespacedComposeRead", () => {
  let tmp: Tmp | null = null;

  beforeEach(() => {
    tmp = null;
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp.repoRoot, { recursive: true, force: true });
  });

  it("flags E37 (warning) when a bare-Compose view never reads its namespaced header", () => {
    tmp = mkTmpPlugin("agntux-stripe");
    writeSrc(
      tmp,
      "agntux-stripe-view.ts",
      `const raw = extractFencedYaml(body, "Compose payload");\n`,
    );
    writeSync(tmp, MERGE_BULLET("stripe"));
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E37");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain("Compose payload (stripe)");
  });

  it("does NOT flag once the view adds the namespaced fallback read (the fix)", () => {
    tmp = mkTmpPlugin("agntux-stripe");
    writeSrc(
      tmp,
      "agntux-stripe-view.ts",
      `const raw = extractFencedYaml(body, "Compose payload")\n` +
        `  ?? extractFencedYaml(body, "Compose payload (stripe)");\n`,
    );
    writeSync(tmp, MERGE_BULLET("stripe"));
    expect(run(tmp)).toEqual([]);
  });

  it("flags a per-view plugin (jira) whose specialized views never read Compose payload (jira)", () => {
    tmp = mkTmpPlugin("agntux-jira");
    writeSrc(
      tmp,
      "agntux-jira-view.ts",
      `parseYamlSection(body, "Comment payload");\n` +
        `parseYamlSection(body, "Transition payload");\n`,
    );
    writeSync(tmp, MERGE_BULLET("jira"));
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E37");
    expect(findings[0]?.message).toContain("Compose payload (jira)");
  });

  it("does NOT flag an inline-only view that reads no on-disk section", () => {
    tmp = mkTmpPlugin("agntux-calendly");
    writeSrc(
      tmp,
      "agntux-calendly-view.ts",
      `function handle(args) { return { structuredContent: args }; }\n`,
    );
    writeSync(tmp, MERGE_BULLET("calendly"));
    expect(run(tmp)).toEqual([]);
  });

  it("does NOT flag when sync.md has no namespaced compose-merge instruction", () => {
    tmp = mkTmpPlugin("agntux-google-calendar");
    writeSrc(
      tmp,
      "view.ts",
      `const raw = parseSectionYaml(body, "Respond payload");\n`,
    );
    writeSync(tmp, "## Step 9\n\nNo cross-source merge here.\n");
    expect(run(tmp)).toEqual([]);
  });

  it("does NOT count a namespaced read that appears only in a comment", () => {
    tmp = mkTmpPlugin("agntux-zoom");
    writeSrc(
      tmp,
      "agntux-zoom-view.ts",
      `// extractFencedYaml(body, "Compose payload (zoom)") — TODO\n` +
        `const raw = extractFencedYaml(body, "Compose payload");\n`,
    );
    writeSync(tmp, MERGE_BULLET("zoom"));
    const findings = run(tmp);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("E37");
  });

  it("skips a plugin with a view-tool but no ingest sync.md (hub-only)", () => {
    tmp = mkTmpPlugin("agntux-core");
    writeSrc(tmp, "view.ts", `extractFencedYaml(body, "Compose payload");\n`);
    expect(run(tmp)).toEqual([]);
  });

  it("stays silent when the plugin has no view-tool/src", () => {
    tmp = mkTmpPlugin("no-view");
    writeSync(tmp, MERGE_BULLET("no-view"));
    expect(run(tmp)).toEqual([]);
  });
});

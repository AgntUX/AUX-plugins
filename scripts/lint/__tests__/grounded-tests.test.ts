/**
 * grounded-tests.test.ts
 *
 * Unit tests for pass 15 (E30) — flag brittle "phantom-contract" tests that
 * grep a per-plugin `reference/`-dir `.md` file with `.toContain(...)`. See
 * `../lint-grounded-tests.ts` for the rationale (the 2026-06-01 calendar build
 * multi-round test churn).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pass15GroundedTests } from "../lint-grounded-tests.js";
import type { Finding } from "../lint-grounded-tests.js";

let pluginDir: string;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lint15-"));
  pluginDir = path.join(root, "plugins", "agntux-foo");
  fs.mkdirSync(path.join(pluginDir, "__tests__"), { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(path.dirname(pluginDir)), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function writeTest(name: string, body: string): void {
  fs.writeFileSync(path.join(pluginDir, "__tests__", name), body, "utf8");
}

// The exact anti-pattern from the calendar build: read a per-plugin reference
// markdown across two lines, then assert an invented phrase.
const BRITTLE = `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = resolve(__dirname, '..');
it('fetch.md forbids client writes', () => {
  const text = readFileSync(
    resolve(ROOT, 'skills/agntux-foo/_overrides/reference/fetch.md'),
    'utf8',
  );
  expect(text).toContain('forbidden by this skill');
});
`;

// A grounded test: asserts on parsed structured data, no reference-prose grep.
const GROUNDED = `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = resolve(__dirname, '..');
it('plugin.json declares a version', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
  expect(pkg.version).toBeTruthy();
});
`;

// The 2026-06-01 idempotent.test.ts gap: a `*-append.md` override splice lives at
// the `_overrides/` ROOT, not under `reference/`, so the old `/reference/`-only
// regex missed it entirely. The broadened predicate must flag it.
const BRITTLE_APPEND = `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const OVERRIDES = resolve(__dirname, '..', 'skills/agntux-foo/_overrides');
it('step-11 documents the lookup heading', () => {
  const text = readFileSync(resolve(OVERRIDES, 'step-11-append.md'), 'utf8');
  expect(text).toContain('## Step 11 — agntux-foo _sources');
});
`;

// Reading the marketplace CANONICAL template is the ONE allowed anchor — a
// literal naming a canonical/ path must NOT be flagged even though it ends .md
// and the file asserts with toContain.
const CANONICAL_ANCHOR = `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = resolve(__dirname, '..');
it('canonical sync.md documents lookup-before-write', () => {
  const text = readFileSync(resolve(ROOT, '../../canonical/prompts/ingest/skills/sync/reference/sync.md'), 'utf8');
  expect(text).toContain('lookup-before-write');
});
`;

// Reading the RENDERED per-plugin tree (no _overrides/) for a short stable token
// is allowed (golden rule source #3) — only the override SOURCE is brittle.
const RENDERED_TOKEN = `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = resolve(__dirname, '..');
it('rendered sync body documents the generic dedup mechanism', () => {
  const text = readFileSync(resolve(ROOT, 'skills/agntux-foo/reference/sync.md'), 'utf8');
  expect(text).toContain('lookup-before-write');
});
`;

describe("pass15GroundedTests (E30)", () => {
  it("flags a test that greps reference prose with toContain", () => {
    writeTest("draft-flow.test.ts", BRITTLE);
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E30");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].file).toBe("__tests__/draft-flow.test.ts");
    expect(findings[0].line).toBe(6); // the reference-path literal line
  });

  it("does NOT flag a grounded test (structured-data assertion, no reference grep)", () => {
    writeTest("cold-start.test.ts", GROUNDED);
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toEqual([]);
  });

  it("does NOT flag a reference read without toContain", () => {
    writeTest("read-only.test.ts", BRITTLE.replace("expect(text).toContain('forbidden by this skill');", "expect(text.length).toBeGreaterThan(0);"));
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toEqual([]);
  });

  it("is silent when there are no test directories", () => {
    fs.rmSync(path.join(pluginDir, "__tests__"), { recursive: true, force: true });
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toEqual([]);
  });

  it("also scans view-tool/__tests__", () => {
    fs.mkdirSync(path.join(pluginDir, "view-tool", "__tests__"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, "view-tool", "__tests__", "vt.test.ts"),
      BRITTLE,
      "utf8",
    );
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("view-tool/__tests__/vt.test.ts");
  });

  // ── Broadened predicate (agntux-build 0.26.0) ──────────────────────────────

  it("flags a `*-append.md` override read (the step-11 gap the old regex missed)", () => {
    writeTest("idempotent.test.ts", BRITTLE_APPEND);
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E30");
  });

  it("does NOT flag a read of the marketplace CANONICAL template (allowed anchor)", () => {
    writeTest("canonical-anchor.test.ts", CANONICAL_ANCHOR);
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toEqual([]);
  });

  it("does NOT flag a stable-token read of the RENDERED tree (no _overrides/)", () => {
    writeTest("rendered-token.test.ts", RENDERED_TOKEN);
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toEqual([]);
  });

  // ── Broadened predicate (agntux-build 0.27.0) — close the evasion paths the
  //    2026-06-02 google-calendar build used to slip past the .md-only regex ──

  it("flags a `_overrides/frontmatter.yaml` read with toContain (cold-start evasion)", () => {
    // The model, told not to grep `_overrides/**.md`, greps the frontmatter
    // substitution map instead — same reworded-prose brittleness, .yaml ext.
    writeTest(
      "cold-start.test.ts",
      `import { readFileSync } from 'node:fs';\n` +
        `import { resolve } from 'node:path';\n` +
        `const ROOT = resolve(__dirname, '..');\n` +
        `it('frontmatter declares the cadence', () => {\n` +
        `  const fm = readFileSync(resolve(ROOT, 'skills/agntux-foo/_overrides/frontmatter.yaml'), 'utf8');\n` +
        `  expect(fm).toContain('source-cursor-semantics:');\n` +
        `});\n`,
    );
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E30");
  });

  it("flags a `data/instructions/<slug>.md` read with toContain (draft-flow evasion)", () => {
    writeTest(
      "draft-flow.test.ts",
      `import { readFileSync } from 'node:fs';\n` +
        `import { resolve } from 'node:path';\n` +
        `const ROOT = resolve(__dirname, '..');\n` +
        `it('instructions document the contract', () => {\n` +
        `  const doc = readFileSync(resolve(ROOT, 'data/instructions/agntux-foo.md'), 'utf8');\n` +
        `  expect(doc).toContain('type: plugin-instructions');\n` +
        `});\n`,
    );
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E30");
  });

  it("flags a `_overrides/frontmatter.yml` read (the `.yml` arm of `ya?ml`)", () => {
    writeTest(
      "alt-ext.test.ts",
      `import { readFileSync } from 'node:fs';\n` +
        `import { resolve } from 'node:path';\n` +
        `const ROOT = resolve(__dirname, '..');\n` +
        `it('frontmatter.yml', () => {\n` +
        `  const fm = readFileSync(resolve(ROOT, 'skills/agntux-foo/_overrides/frontmatter.yml'), 'utf8');\n` +
        `  expect(fm).toContain('plugin-slug:');\n` +
        `});\n`,
    );
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("E30");
  });

  it("does NOT flag a `data/instructions/<slug>.yaml` read (that arm is `.md`-only)", () => {
    // The data/instructions alternative matches `.md` only — a structured
    // `.yaml` data file there is parseable config, not reworded prose.
    writeTest(
      "data-yaml.test.ts",
      `import { readFileSync } from 'node:fs';\n` +
        `import { resolve } from 'node:path';\n` +
        `const ROOT = resolve(__dirname, '..');\n` +
        `it('data yaml', () => {\n` +
        `  const d = readFileSync(resolve(ROOT, 'data/instructions/agntux-foo.yaml'), 'utf8');\n` +
        `  expect(d).toContain('kind:');\n` +
        `});\n`,
    );
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toEqual([]);
  });

  it("does NOT flag a `marketplace/listing.yaml` read with toContain (grounded source #2)", () => {
    // listing.yaml is structured config the manifest-author owns — the golden
    // rule's grounded source #2. It is NOT under `_overrides/`, so it stays legal.
    writeTest(
      "listing.test.ts",
      `import { readFileSync } from 'node:fs';\n` +
        `import { resolve } from 'node:path';\n` +
        `const ROOT = resolve(__dirname, '..');\n` +
        `it('listing declares two ui_components', () => {\n` +
        `  const y = readFileSync(resolve(ROOT, 'marketplace/listing.yaml'), 'utf8');\n` +
        `  expect(y).toContain('ui_components:');\n` +
        `});\n`,
    );
    const findings: Finding[] = [];
    pass15GroundedTests("agntux-foo", pluginDir, "/repo", findings);
    expect(findings).toEqual([]);
  });
});

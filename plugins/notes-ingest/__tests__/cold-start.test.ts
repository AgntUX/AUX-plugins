/**
 * cold-start.test.ts
 *
 * Structural test: verifies that the notes-ingest plugin's expected output files
 * (entities, action items, sync state) exist and conform to P3 schemas.
 *
 * LIMITATION (per T18 pattern): this is a structural/static test that validates
 * the *expected-* fixture files against P3 schema rules. It does NOT run a full
 * LLM round-trip — the ingest agent is an LLM that cannot be invoked in-process
 * by a unit test runner. Instead, the test asserts that:
 *
 *   1. The example fixture files conform to the P3 entity and action-item schemas
 *      (frontmatter fields, section headings, slug rules, schema_version).
 *   2. The ingest agent prompt (agents/ingest.md) contains all required placeholders
 *      substituted to their notes-ingest values.
 *   3. The plugin manifest declares the required fields.
 *   4. The hooks/hooks.json has the correct ingest-variant shape (no PostToolUse).
 *
 * For a real end-to-end test that exercises the ingest agent against live notes,
 * use the workflow-test CLI after deploying the plugin.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = join(PLUGIN_ROOT, "examples", "acme-meeting");
const EXPECTED_ENTITIES = join(EXAMPLES_DIR, "expected-entities");
const EXPECTED_ACTIONS = join(EXAMPLES_DIR, "expected-actions");
const EXPECTED_STATE = join(EXAMPLES_DIR, "expected-state");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readMd(p: string): string {
  return readFileSync(p, "utf-8");
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fm[key] = value;
  }
  return fm;
}

function hasSections(content: string, sections: string[]): boolean {
  return sections.every((s) => content.includes(`## ${s}`));
}

// ---------------------------------------------------------------------------
// Pass 1: plugin manifest
// ---------------------------------------------------------------------------

describe("plugin manifest", () => {
  const manifestPath = join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");

  it("plugin.json exists", () => {
    expect(existsSync(manifestPath)).toBe(true);
  });

  it("plugin.json has required fields", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    expect(manifest.name).toBe("notes-ingest");
    expect(manifest.version).toBe("1.0.0");
    expect(typeof manifest.description).toBe("string");
    expect(manifest.license).toBe("ELv2");
  });

  it("plugin.json has recommended_ingest_cadence", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    expect(typeof manifest.recommended_ingest_cadence).toBe("string");
    // Must match Daily HH:MM pattern
    expect(manifest.recommended_ingest_cadence).toMatch(/^Daily \d{2}:\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// Pass 2: hooks shape (ingest variant — no PostToolUse)
// ---------------------------------------------------------------------------

describe("hooks shape (ingest variant)", () => {
  const hooksPath = join(PLUGIN_ROOT, "hooks", "hooks.json");

  it("hooks.json exists", () => {
    expect(existsSync(hooksPath)).toBe(true);
  });

  it("has SessionStart with license-check", () => {
    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const entries = hooks.hooks.SessionStart ?? [];
    const cmds = entries.flatMap((e) => e.hooks ?? []).map((h) => h.command ?? "");
    expect(cmds.some((c) => c.includes("license-check.mjs"))).toBe(true);
  });

  it("has PreToolUse with license-validate", () => {
    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
    };
    const entries = hooks.hooks.PreToolUse ?? [];
    const entry = entries.find((e) =>
      (e.hooks ?? []).some((h) => (h.command ?? "").includes("license-validate.mjs"))
    );
    expect(entry).toBeDefined();
    expect(entry?.matcher).toMatch(/Write\|Edit/);
  });

  it("does NOT have PostToolUse (ingest plugins do not own the maintain-index hook)", () => {
    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
      hooks: Record<string, unknown>;
    };
    expect(hooks.hooks.PostToolUse).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pass 3: agent prompt substitution
// ---------------------------------------------------------------------------

describe("agent prompt substitution", () => {
  const ingestMd = join(PLUGIN_ROOT, "agents", "ingest.md");
  const orchestratorMd = join(PLUGIN_ROOT, "skills", "orchestrator.md");

  it("agents/ingest.md exists", () => {
    expect(existsSync(ingestMd)).toBe(true);
  });

  it("skills/orchestrator.md exists", () => {
    expect(existsSync(orchestratorMd)).toBe(true);
  });

  it("ingest.md has no unsubstituted {{placeholder}} tokens (word-char content only)", () => {
    const src = readMd(ingestMd);
    // Match {{word-content}} — real template placeholders like {{plugin-slug}}.
    // Excludes literal {{...}} or {{imperative}} prose examples which use non-word chars.
    const matches = src.match(/\{\{[\w-]+\}\}/g) ?? [];
    expect(matches).toHaveLength(0);
  });

  it("orchestrator.md has no unsubstituted {{placeholder}} tokens (word-char content only)", () => {
    const src = readMd(orchestratorMd);
    // Match {{word-content}} — real template placeholders like {{plugin-slug}}.
    // Excludes literal {{...}} prose examples which use non-word chars.
    const matches = src.match(/\{\{[\w-]+\}\}/g) ?? [];
    expect(matches).toHaveLength(0);
  });

  it("ingest.md contains notes-specific cursor semantics", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("Filesystem mtime");
  });

  it("ingest.md references the filesystem MCP tools", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("mcp__filesystem__read_file");
    expect(src).toContain("mcp__filesystem__list_directory");
  });

  it("orchestrator.md declares Lane B unused", () => {
    const src = readMd(orchestratorMd);
    expect(src).toContain("(this plugin ships no UI components — Lane B is unused)");
  });
});

// ---------------------------------------------------------------------------
// Pass 4: Acme example entity files conform to P3 entity schema
// ---------------------------------------------------------------------------

const entityFiles = [
  { path: join(EXPECTED_ENTITIES, "companies", "acme-corp.md"), expectedId: "acme-corp", expectedSubtype: "company" },
  { path: join(EXPECTED_ENTITIES, "people", "john-smith-acme.md"), expectedId: "john-smith-acme", expectedSubtype: "person" },
  { path: join(EXPECTED_ENTITIES, "topics", "q2-renewal-acme.md"), expectedId: "q2-renewal-acme", expectedSubtype: "topic" },
  { path: join(EXPECTED_ENTITIES, "topics", "project-mango.md"), expectedId: "project-mango", expectedSubtype: "topic" },
];

describe("Acme example entity files", () => {
  for (const { path: filePath, expectedId, expectedSubtype } of entityFiles) {
    const label = expectedId;

    it(`${label}: file exists`, () => {
      expect(existsSync(filePath)).toBe(true);
    });

    it(`${label}: required frontmatter fields present`, () => {
      const content = readMd(filePath);
      const fm = parseFrontmatter(content);
      expect(fm.id).toBe(expectedId);
      expect(fm.type).toBe("entity");
      expect(fm.schema_version).toBe('"1.0.0"');
      expect(fm.subtype).toBe(expectedSubtype);
      expect(fm.created_at).toBeTruthy();
      expect(fm.updated_at).toBeTruthy();
    });

    it(`${label}: has all four required body sections`, () => {
      const content = readMd(filePath);
      expect(hasSections(content, ["Summary", "Key Facts", "Recent Activity", "User notes"])).toBe(true);
    });

    it(`${label}: User notes is the last section`, () => {
      const content = readMd(filePath);
      const userNotesIdx = content.lastIndexOf("## User notes");
      const afterUserNotes = content.slice(userNotesIdx + "## User notes".length);
      // No further ## headings after User notes
      expect(afterUserNotes).not.toMatch(/^## /m);
    });

    it(`${label}: source is notes`, () => {
      const content = readMd(filePath);
      expect(content).toContain("notes:");
    });

    it(`${label}: Recent Activity has at least one notes entry`, () => {
      const content = readMd(filePath);
      expect(content).toMatch(/- \d{4}-\d{2}-\d{2} — notes:/);
    });
  }
});

// ---------------------------------------------------------------------------
// Pass 5: Acme action item conforms to P3 action-item schema
// ---------------------------------------------------------------------------

describe("Acme action item", () => {
  const actionPath = join(EXPECTED_ACTIONS, "2026-04-25-acme-renewal-pricing-quote.md");

  it("action file exists", () => {
    expect(existsSync(actionPath)).toBe(true);
  });

  it("required frontmatter fields present", () => {
    const content = readMd(actionPath);
    const fm = parseFrontmatter(content);
    expect(fm.id).toBe("2026-04-25-acme-renewal-pricing-quote");
    expect(fm.type).toBe("action-item");
    expect(fm.schema_version).toBe('"1.0.0"');
    expect(fm.status).toBe("open");
    expect(["high", "medium", "low"]).toContain(fm.priority);
    expect(["deadline", "response-needed", "knowledge-update", "risk", "opportunity", "other"]).toContain(fm.reason_class);
    expect(fm.source).toBe("notes");
  });

  it("has both required body sections", () => {
    const content = readMd(actionPath);
    expect(hasSections(content, ["Why this matters", "Personalization fit"])).toBe(true);
  });

  it("priority is high (deadline within 7 days)", () => {
    const content = readMd(actionPath);
    const fm = parseFrontmatter(content);
    expect(fm.priority).toBe("high");
  });

  it("reason_class is deadline", () => {
    const content = readMd(actionPath);
    const fm = parseFrontmatter(content);
    expect(fm.reason_class).toBe("deadline");
  });

  it("references acme-corp entity", () => {
    const content = readMd(actionPath);
    expect(content).toContain("companies/acme-corp");
  });

  it("suggested_actions host_prompts start with ux:", () => {
    const content = readMd(actionPath);
    const lines = content.split("\n");
    const promptLines = lines.filter((l) => l.trim().startsWith("ux: Use the"));
    expect(promptLines.length).toBeGreaterThan(0);
    for (const line of promptLines) {
      expect(line.trim()).toMatch(/^ux: Use the (notes-ingest|agntux-core) plugin to/);
    }
  });
});

// ---------------------------------------------------------------------------
// Pass 6: expected sync state
// ---------------------------------------------------------------------------

describe("expected sync state", () => {
  const syncPath = join(EXPECTED_STATE, ".state", "sync.md");

  it("sync.md exists", () => {
    expect(existsSync(syncPath)).toBe(true);
  });

  it("has # notes section", () => {
    const content = readMd(syncPath);
    expect(content).toContain("# notes");
  });

  it("cursor is advanced (non-null)", () => {
    const content = readMd(syncPath);
    expect(content).toMatch(/- cursor: "[^"]+"/);
    // Must NOT be null
    expect(content).not.toContain("- cursor: null");
  });

  it("last_success is set", () => {
    const content = readMd(syncPath);
    expect(content).toMatch(/- last_success: "[^"]+"/);
    expect(content).not.toContain("- last_success: null");
  });

  it("lock is released", () => {
    const content = readMd(syncPath);
    expect(content).toContain("- lock: null");
  });

  it("items_processed is 1 for single Acme note", () => {
    const content = readMd(syncPath);
    expect(content).toContain("- items_processed: 1");
  });
});

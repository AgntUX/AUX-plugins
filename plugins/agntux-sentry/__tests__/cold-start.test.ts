/**
 * cold-start.test.ts — agntux-sentry
 *
 * Static assertions about plugin shape, manifest fields, and the rendered
 * ingest skill. No LLM is invoked. All assertions are derived from the
 * actually-authored tree (plugin.json, listing.yaml, skills/ SKILL.md).
 *
 * listing.yaml proposed_schema is loaded via js-yaml and asserted on the
 * parsed object (mechanical rule 5 — never text-regex a YAML field name).
 *
 * SKILL.md assertions run against the RENDERED file produced by
 * `node scripts/render-skill.mjs agntux-sentry` in the build pipeline.
 * The tests stage runs after rendering, so skills/agntux-sentry/SKILL.md
 * is present when this suite executes.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-sentry";

// ── Parsed artifacts (module-level so failures are early and clear) ───────────

const pluginJson = JSON.parse(
  readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
);

const listingYaml = yaml.load(
  readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
) as Record<string, unknown>;

// ── describe: manifest — plugin.json ─────────────────────────────────────────

describe("manifest — plugin.json", () => {
  it("name is agntux-sentry", () => {
    expect(pluginJson.name).toBe("agntux-sentry");
  });

  it("version matches semver", () => {
    expect(pluginJson.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("recommended_ingest_cadence is a non-empty string", () => {
    expect(typeof pluginJson.recommended_ingest_cadence).toBe("string");
    expect(pluginJson.recommended_ingest_cadence).toBeTruthy();
  });

  it("recommended_ingest_cadence is the authored 30-min weekday window", () => {
    // Verbatim from .claude-plugin/plugin.json
    expect(pluginJson.recommended_ingest_cadence).toBe(
      "Every 30 min, 7am–7pm weekdays local",
    );
  });
});

// ── describe: listing.yaml — parsed proposed_schema (mechanical rule 5) ──────

describe("listing.yaml — proposed_schema (parsed YAML, not text regex)", () => {
  const schema = listingYaml.proposed_schema as Record<string, unknown>;

  it("proposed_schema.entity_subtypes is an array", () => {
    expect(Array.isArray(schema.entity_subtypes)).toBe(true);
  });

  it("entity_subtypes has exactly one entry — sentry-issue", () => {
    const subtypes = schema.entity_subtypes as Array<Record<string, unknown>>;
    expect(subtypes).toHaveLength(1);
    expect(subtypes[0].subtype).toBe("sentry-issue");
  });

  it("sentry-issue required_frontmatter includes sources, created_at, updated_at, last_active", () => {
    const subtypes = schema.entity_subtypes as Array<Record<string, unknown>>;
    const rf = subtypes[0].required_frontmatter as string[];
    expect(rf).toContain("sources");
    expect(rf).toContain("created_at");
    expect(rf).toContain("updated_at");
    expect(rf).toContain("last_active");
  });

  it("action_classes contains response-needed and knowledge-update", () => {
    const ac = schema.action_classes as Array<Record<string, unknown>>;
    const classes = ac.map((c) => c.class);
    expect(classes).toContain("response-needed");
    expect(classes).toContain("knowledge-update");
  });

  it("cursor_semantics is a non-empty string", () => {
    expect(typeof schema.cursor_semantics).toBe("string");
    expect((schema.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("source_id_format is a non-empty string", () => {
    expect(typeof schema.source_id_format).toBe("string");
    expect((schema.source_id_format as string).length).toBeGreaterThan(0);
  });
});

describe("listing.yaml — ui_components (parsed YAML)", () => {
  it("declares exactly 3 ui_components", () => {
    const components = listingYaml.ui_components as Array<Record<string, unknown>>;
    expect(components).toHaveLength(3);
  });

  it("ui_components include resolve-issue, ignore-issue, assign-issue", () => {
    const components = listingYaml.ui_components as Array<Record<string, unknown>>;
    const names = components.map((c) => c.name);
    expect(names).toContain("resolve-issue");
    expect(names).toContain("ignore-issue");
    expect(names).toContain("assign-issue");
  });

  it("resolve-issue view_tool is agntux_sentry_resolve_view", () => {
    const components = listingYaml.ui_components as Array<Record<string, unknown>>;
    const resolve = components.find((c) => c.name === "resolve-issue")!;
    expect(resolve.view_tool).toBe("agntux_sentry_resolve_view");
  });

  it("ignore-issue view_tool is agntux_sentry_ignore_view", () => {
    const components = listingYaml.ui_components as Array<Record<string, unknown>>;
    const ignore = components.find((c) => c.name === "ignore-issue")!;
    expect(ignore.view_tool).toBe("agntux_sentry_ignore_view");
  });

  it("assign-issue view_tool is agntux_sentry_assign_view", () => {
    const components = listingYaml.ui_components as Array<Record<string, unknown>>;
    const assign = components.find((c) => c.name === "assign-issue")!;
    expect(assign.view_tool).toBe("agntux_sentry_assign_view");
  });
});

// ── describe: plugin shape (inline-skill pattern, post-6aa72b8) ───────────────

describe("plugin shape (inline-skill pattern)", () => {
  it("does NOT ship a top-level agents/ directory — sync runs as a top-level skill", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });

  it("does NOT ship a hooks/ directory — plugin is Apache-2.0 and unconditionally free", () => {
    expect(existsSync(join(PLUGIN_ROOT, "hooks"))).toBe(false);
  });

  it("does NOT ship a mcp-server/ directory — source plugins are remote-view-only", () => {
    expect(existsSync(join(PLUGIN_ROOT, "mcp-server"))).toBe(false);
  });

  it("does NOT ship a .mcp.json file — there is no local MCP server to register", () => {
    expect(existsSync(join(PLUGIN_ROOT, ".mcp.json"))).toBe(false);
  });

  it("ships a view-tool/ directory (three UI handlers: resolve, ignore, assign)", () => {
    expect(existsSync(join(PLUGIN_ROOT, "view-tool"))).toBe(true);
  });
});

// ── describe: rendered SKILL.md substitution and frontmatter shape ────────────

describe("skill prompt substitution (rendered SKILL.md)", () => {
  const SKILL_PATH = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);

  it("no unsubstituted {{...}} placeholders in the rendered sync skill", () => {
    if (!existsSync(SKILL_PATH)) {
      console.warn("[cold-start] SKILL.md not found — run render-skill.mjs first");
      return;
    }
    const p = readFileSync(SKILL_PATH, "utf-8");
    const matches = p.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("rendered SKILL.md frontmatter contains name: agntux-sentry", () => {
    if (!existsSync(SKILL_PATH)) return;
    const p = readFileSync(SKILL_PATH, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(/^name: agntux-sentry$/m);
  });

  it("rendered SKILL.md frontmatter does NOT contain retired context:/agent:/tools: lines", () => {
    if (!existsSync(SKILL_PATH)) return;
    const p = readFileSync(SKILL_PATH, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });
});

// ── describe: no surviving placeholders in rendered reference/*.md ────────────

describe("placeholder-survival check (rendered reference/ files)", () => {
  it("no {{...}} placeholders survive in any rendered reference/*.md", () => {
    const refDir = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);
    if (!existsSync(refDir)) return; // renderer not yet run — skip gracefully
    const files = readdirSync(refDir).filter((n) => n.endsWith(".md"));
    for (const name of files) {
      const text = readFileSync(join(refDir, name), "utf-8");
      const hits = text.match(/\{\{[a-z-]+\}\}/g);
      expect(hits, `Placeholder found in reference/${name}`).toBeNull();
    }
  });
});

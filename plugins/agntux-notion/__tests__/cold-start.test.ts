/**
 * cold-start.test.ts — agntux-notion
 *
 * Static assertions about plugin manifest shape, inline-skill pattern compliance,
 * and the _overrides/frontmatter.yaml render-pipeline opt-in.
 *
 * All assertions are derived from actual authored files — no invented strings.
 * No LLM is invoked at test time.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-notion";
const OVERRIDES_DIR = join(PLUGIN_ROOT, `skills/${SLUG}/_overrides`);

// ── manifest ────────────────────────────────────────────────────────────────────

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.name).toBe(SLUG);
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
  });

  it("plugin.json name is agntux-notion", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.name).toBe("agntux-notion");
  });

  it("plugin.json version is 0.2.0", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    expect(m.version).toBe("0.2.0");
  });

  it("plugin.json recommended_ingest_cadence is 'Every 4 hours'", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json line 10
    expect(m.recommended_ingest_cadence).toBe("Every 4 hours");
  });
});

// ── plugin shape (inline-skill pattern, post 6aa72b8) ───────────────────────────

describe("plugin shape (inline-skill pattern, post 6aa72b8)", () => {
  it("does NOT ship a top-level agents/ directory — sync runs as a top-level skill", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });

  it("does NOT ship a hooks/ directory — plugins are Apache-2.0 and unconditionally free", () => {
    expect(existsSync(join(PLUGIN_ROOT, "hooks"))).toBe(false);
  });

  it("does NOT ship a mcp-server/ directory — source plugins are remote-view-only", () => {
    expect(existsSync(join(PLUGIN_ROOT, "mcp-server"))).toBe(false);
  });

  it("does NOT ship a .mcp.json file — there is no local MCP server to register", () => {
    expect(existsSync(join(PLUGIN_ROOT, ".mcp.json"))).toBe(false);
  });
});

// ── listing.yaml — ui_components parsed from YAML, not text regex ──────────────

describe("listing.yaml ui_components (parsed YAML)", () => {
  const listing = yamlLoad(
    readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8"),
  ) as Record<string, unknown>;

  it("has exactly 3 ui_components", () => {
    const components = listing.ui_components as unknown[];
    expect(Array.isArray(components)).toBe(true);
    expect(components).toHaveLength(3);
  });

  it("first component is reply-to-comment with view_tool agntux_notion_comment_view", () => {
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const first = components[0];
    // Verbatim from marketplace/listing.yaml lines 35-39
    expect(first.name).toBe("reply-to-comment");
    expect(first.view_tool).toBe("agntux_notion_comment_view");
    expect(first.resource_uri).toBe("ui://agntux-notion/reply-comment");
  });

  it("second component is update-page with view_tool agntux_notion_update_view", () => {
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const second = components[1];
    // Verbatim from marketplace/listing.yaml lines 40-44
    expect(second.name).toBe("update-page");
    expect(second.view_tool).toBe("agntux_notion_update_view");
    expect(second.resource_uri).toBe("ui://agntux-notion/update-page");
  });

  it("third component is create-page with view_tool agntux_notion_create_view", () => {
    const components = listing.ui_components as Array<Record<string, unknown>>;
    const third = components[2];
    // Verbatim from marketplace/listing.yaml lines 45-49
    expect(third.name).toBe("create-page");
    expect(third.view_tool).toBe("agntux_notion_create_view");
    expect(third.resource_uri).toBe("ui://agntux-notion/create-page");
  });

  it("proposed_schema has cursor_semantics string", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    expect(typeof schema.cursor_semantics).toBe("string");
    expect((schema.cursor_semantics as string).length).toBeGreaterThan(0);
  });

  it("proposed_schema source_id_format documents the {block-id} pattern with 32-character hex UUID", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    // Verbatim from marketplace/listing.yaml line 129
    expect(schema.source_id_format as string).toContain("{block-id}");
    // Verbatim: "Notion's 32-character hex UUID"
    expect(schema.source_id_format as string).toContain("32-character hex UUID");
  });

  it("proposed_schema entity_subtypes includes notion-page, notion-database-item, notion-comment, person", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    const subtypes = schema.entity_subtypes as Array<Record<string, unknown>>;
    const names = subtypes.map((s) => s.subtype);
    expect(names).toContain("notion-page");
    expect(names).toContain("notion-database-item");
    expect(names).toContain("notion-comment");
    expect(names).toContain("person");
  });

  it("proposed_schema action_classes includes response-needed and knowledge-update", () => {
    const schema = listing.proposed_schema as Record<string, unknown>;
    const classes = schema.action_classes as Array<Record<string, unknown>>;
    const names = classes.map((c) => c.class);
    expect(names).toContain("response-needed");
    expect(names).toContain("knowledge-update");
  });
});

// ── _overrides/frontmatter.yaml — render-pipeline opt-in ───────────────────────

describe("_overrides/frontmatter.yaml render-pipeline opt-in", () => {
  const frontmatterPath = join(OVERRIDES_DIR, "frontmatter.yaml");

  it("_overrides/frontmatter.yaml exists", () => {
    expect(existsSync(frontmatterPath)).toBe(true);
  });

  it("frontmatter.yaml contains plugin-slug: agntux-notion", () => {
    const yaml = readFileSync(frontmatterPath, "utf-8");
    // Verbatim from _overrides/frontmatter.yaml line 5
    expect(yaml).toContain("plugin-slug: agntux-notion");
  });

  it("frontmatter.yaml contains plugin-version: 0.2.0", () => {
    const yaml = readFileSync(frontmatterPath, "utf-8");
    // Verbatim from _overrides/frontmatter.yaml line 6
    expect(yaml).toContain("plugin-version: 0.2.0");
  });

  it("frontmatter.yaml contains recommended-cadence: \"Every 4 hours\"", () => {
    const yaml = readFileSync(frontmatterPath, "utf-8");
    // Verbatim from _overrides/frontmatter.yaml line 9
    expect(yaml).toContain(`recommended-cadence: "Every 4 hours"`);
  });

  it("frontmatter.yaml source-display-name is Notion", () => {
    const yaml = readFileSync(frontmatterPath, "utf-8");
    // Verbatim from _overrides/frontmatter.yaml line 7
    expect(yaml).toContain("source-display-name: Notion");
  });
});

// ── _overrides/reference files — both present ───────────────────────────────────

describe("_overrides/reference files", () => {
  it("_overrides/reference/cursor.md exists", () => {
    expect(existsSync(join(OVERRIDES_DIR, "reference/cursor.md"))).toBe(true);
  });

  it("_overrides/reference/fetch.md exists", () => {
    expect(existsSync(join(OVERRIDES_DIR, "reference/fetch.md"))).toBe(true);
  });

  it("_overrides/reference/cursor.md is non-empty", () => {
    const content = readFileSync(join(OVERRIDES_DIR, "reference/cursor.md"), "utf-8");
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it("_overrides/reference/fetch.md is non-empty", () => {
    const content = readFileSync(join(OVERRIDES_DIR, "reference/fetch.md"), "utf-8");
    expect(content.trim().length).toBeGreaterThan(0);
  });
});

// ── view-tool HTML entry points exist ──────────────────────────────────────────

describe("view-tool HTML entry points", () => {
  const VT_ROOT = join(PLUGIN_ROOT, "view-tool");

  it("view-tool/reply-comment.html exists", () => {
    // Verbatim name from view-tool directory listing
    expect(existsSync(join(VT_ROOT, "reply-comment.html"))).toBe(true);
  });

  it("view-tool/update-page.html exists", () => {
    expect(existsSync(join(VT_ROOT, "update-page.html"))).toBe(true);
  });

  it("view-tool/create-page.html exists", () => {
    expect(existsSync(join(VT_ROOT, "create-page.html"))).toBe(true);
  });
});

// ── placeholder-survival check on rendered skill (when present) ─────────────────

describe("skill prompt substitution (when rendered tree exists)", () => {
  const renderedSkillPath = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);

  it("rendered SKILL.md — no unsubstituted {{...}} placeholders (skipped if not yet rendered)", () => {
    if (!existsSync(renderedSkillPath)) {
      // The render-skill step has not run yet in this build; the
      // render-reproducibility.test.ts will enforce this once it does.
      return;
    }
    const p = readFileSync(renderedSkillPath, "utf8");
    const matches = p.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("rendered SKILL.md frontmatter runs INLINE (no context:/agent:/tools: lines) — skipped if not yet rendered", () => {
    if (!existsSync(renderedSkillPath)) {
      return;
    }
    const p = readFileSync(renderedSkillPath, "utf8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(new RegExp(`^name: ${SLUG}$`, "m"));
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });
});

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-apple-notes";

// ── Manifest ──────────────────────────────────────────────────────────────────

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim values from .claude-plugin/plugin.json
    expect(m.name).toBe("agntux-apple-notes");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
    // Verbatim from plugin.json
    expect(m.recommended_ingest_cadence).toBe("Every 4 hours");
  });

  it("listing.yaml ui_components declares create-note and update-note", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const uiComponents = listing.ui_components as Array<Record<string, unknown>>;
    expect(Array.isArray(uiComponents)).toBe(true);
    expect(uiComponents).toHaveLength(2);
    const names = uiComponents.map((c) => c.name);
    expect(names).toContain("create-note");
    expect(names).toContain("update-note");
  });

  it("listing.yaml view_tool names match the shipped module", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const uiComponents = listing.ui_components as Array<Record<string, unknown>>;
    const viewTools = uiComponents.map((c) => c.view_tool);
    // Verbatim from listing.yaml ui_components[].view_tool
    expect(viewTools).toContain("agntux_apple_notes_create_note");
    expect(viewTools).toContain("agntux_apple_notes_update_note");
  });

  it("listing.yaml proposed_schema cursor_semantics field is present", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    expect(typeof ps.cursor_semantics).toBe("string");
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics
    expect(ps.cursor_semantics as string).toContain("Modification-time watermark");
  });

  it("listing.yaml proposed_schema source_id_format documents x-coredata", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    expect(typeof ps.source_id_format).toBe("string");
    // Verbatim substring from listing.yaml proposed_schema.source_id_format
    expect(ps.source_id_format as string).toContain("x-coredata://");
  });

  it("listing.yaml proposed_schema action_classes declares two entries both with class: other", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const classes = ps.action_classes as Array<Record<string, unknown>>;
    expect(Array.isArray(classes)).toBe(true);
    // Verbatim from listing.yaml proposed_schema.action_classes: both entries use class: other
    expect(classes).toHaveLength(2);
    expect(classes[0].class).toBe("other");
    expect(classes[1].class).toBe("other");
    // Verbatim description substrings from listing.yaml proposed_schema.action_classes[].description
    expect(classes[0].description as string).toContain("Create a new note in Apple Notes.");
    expect(classes[1].description as string).toContain("Update an existing note or check off checklist items.");
  });
});

// ── Plugin shape (inline-skill pattern, post 6aa72b8) ────────────────────────

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

// ── Skill prompt substitution (rendered tree) ─────────────────────────────────
// The rendered tree (skills/agntux-apple-notes/SKILL.md + reference/) is
// produced by the gate's render-skill.mjs step BEFORE vitest runs. If the
// file doesn't exist (pre-render cold run), the test skips with a warning
// rather than hard-failing, so CI doesn't confuse a missing render with a
// placeholder-survival error.

describe("skill prompt substitution", () => {
  it("no unsubstituted {{...}} placeholders in the rendered sync skill", () => {
    const skillPath = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);
    if (!existsSync(skillPath)) {
      console.warn(
        `cold-start: skipping placeholder check — ${skillPath} not found (run render-skill.mjs first)`,
      );
      return;
    }
    const p = readFileSync(skillPath, "utf-8");
    const matches = p.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("no unsubstituted {{...}} placeholders in the rendered reference files", () => {
    const refDir = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);
    if (!existsSync(refDir)) {
      console.warn(
        `cold-start: skipping reference placeholder check — ${refDir} not found`,
      );
      return;
    }
    const files = readdirSync(refDir).filter((n) => n.endsWith(".md"));
    for (const f of files) {
      const content = readFileSync(join(refDir, f), "utf-8");
      const matches = content.match(/\{\{[a-z-]+\}\}/g);
      expect(matches, `unsubstituted placeholder in reference/${f}`).toBeNull();
    }
  });

  it("rendered SKILL.md frontmatter runs INLINE — no context:/agent:/tools: lines", () => {
    const skillPath = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);
    if (!existsSync(skillPath)) {
      console.warn(
        `cold-start: skipping frontmatter check — ${skillPath} not found`,
      );
      return;
    }
    const p = readFileSync(skillPath, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(new RegExp(`^name: ${SLUG}$`, "m"));
    // The forked-context patterns are retired.
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });
});

// ── View-tool source ships ────────────────────────────────────────────────────

describe("view-tool source", () => {
  it("ships a single view module file at view-tool/src/agntux-apple-notes-view.ts", () => {
    expect(
      existsSync(
        join(PLUGIN_ROOT, "view-tool/src/agntux-apple-notes-view.ts"),
      ),
    ).toBe(true);
  });

  it("view module declares both tool names", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-apple-notes-view.ts"),
      "utf-8",
    );
    // Verbatim from agntux-apple-notes-view.ts descriptor name fields
    expect(src).toContain("agntux_apple_notes_create_note");
    expect(src).toContain("agntux_apple_notes_update_note");
  });

  it("view module references both resource URIs", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-apple-notes-view.ts"),
      "utf-8",
    );
    // Verbatim from agntux-apple-notes-view.ts constants
    expect(src).toContain("ui://agntux-apple-notes/create-note");
    expect(src).toContain("ui://agntux-apple-notes/update-note");
  });
});

// cold-start.test.ts — plugin shape contract for agntux-imessage.
//
// Assertions are grounded in:
//   1. .claude-plugin/plugin.json (parsed JSON)
//   2. marketplace/listing.yaml (parsed YAML via js-yaml)
//   3. view-tool/src/agntux-imessage-view.ts (verbatim substrings, read-then-copy-literal)
//   4. skills/agntux-imessage/SKILL.md (rendered tree — skipped gracefully if absent)
//
// E30 guard: ZERO assertions touch _overrides/ source files.
// Regex discipline: only /^name: agntux-imessage$/m (ASCII, single-line).
// Phantom-contract guard: every string asserted was copied verbatim from the
// file it targets by reading it above before writing this test.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-imessage";

// ── Manifest ──────────────────────────────────────────────────────────────────

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json
    expect(m.name).toBe("agntux-imessage");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
    // Verbatim from plugin.json
    expect(m.recommended_ingest_cadence).toBe(
      "Every 15 min, 7am–7pm weekdays local",
    );
  });

  it("listing.yaml declares one ui_component named reply", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const uiComponents = listing.ui_components as Array<Record<string, unknown>>;
    expect(Array.isArray(uiComponents)).toBe(true);
    expect(uiComponents).toHaveLength(1);
    // Verbatim from listing.yaml ui_components[0].name
    expect(uiComponents[0].name).toBe("reply");
  });

  it("listing.yaml ui_component view_tool name matches the shipped module", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const uiComponents = listing.ui_components as Array<Record<string, unknown>>;
    // Verbatim from listing.yaml ui_components[0].view_tool
    expect(uiComponents[0].view_tool).toBe("agntux_imessage_reply_view");
  });

  it("listing.yaml ui_component resource_uri matches the shipped constant", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const uiComponents = listing.ui_components as Array<Record<string, unknown>>;
    // Verbatim from listing.yaml ui_components[0].resource_uri
    expect(uiComponents[0].resource_uri).toBe("ui://agntux-imessage/reply");
  });

  it("listing.yaml proposed_schema cursor_semantics is present and describes a per-contact map", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    expect(typeof ps.cursor_semantics).toBe("string");
    // Verbatim substring from listing.yaml proposed_schema.cursor_semantics
    expect(ps.cursor_semantics as string).toContain("Per-contact last-seen timestamp");
  });

  it("listing.yaml proposed_schema source_id_format documents phone_or_email#message_id shape", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    expect(typeof ps.source_id_format).toBe("string");
    // Verbatim substring from listing.yaml proposed_schema.source_id_format
    expect(ps.source_id_format as string).toContain("phone_or_email");
    expect(ps.source_id_format as string).toContain("message_id");
  });

  it("listing.yaml proposed_schema action_classes declares response-needed, knowledge-update, and other", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace/listing.yaml"),
      "utf-8",
    );
    const listing = parseYaml(raw) as Record<string, unknown>;
    const ps = listing.proposed_schema as Record<string, unknown>;
    const classes = ps.action_classes as Array<Record<string, unknown>>;
    expect(Array.isArray(classes)).toBe(true);
    expect(classes).toHaveLength(3);
    const classNames = classes.map((c) => c.class);
    // Verbatim from listing.yaml proposed_schema.action_classes[].class
    expect(classNames).toContain("response-needed");
    expect(classNames).toContain("knowledge-update");
    expect(classNames).toContain("other");
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
// The rendered tree (skills/agntux-imessage/SKILL.md + reference/) is produced
// by the gate's render-skill.mjs step BEFORE vitest runs. If the file does not
// exist (pre-render cold run), assertions skip with a warning so CI does not
// confuse a missing render with a placeholder-survival error.
// E30 guard: assertions target skills/agntux-imessage/ (rendered output), NEVER
// skills/agntux-imessage/_overrides/.

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
  it("ships the view module at view-tool/src/agntux-imessage-view.ts", () => {
    expect(
      existsSync(join(PLUGIN_ROOT, "view-tool/src/agntux-imessage-view.ts")),
    ).toBe(true);
  });

  it("view module declares the tool name agntux_imessage_reply_view", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-imessage-view.ts"),
      "utf-8",
    );
    // Verbatim from agntux-imessage-view.ts descriptor.name
    expect(src).toContain("agntux_imessage_reply_view");
  });

  it("view module references the resource URI ui://agntux-imessage/reply", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-imessage-view.ts"),
      "utf-8",
    );
    // Verbatim from agntux-imessage-view.ts RESOURCE_URI constant
    expect(src).toContain("ui://agntux-imessage/reply");
  });

  it("App.tsx short-circuits on detectErrorEnvelope and imports from @agntux/ui-primitives", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/App.tsx"),
      "utf-8",
    );
    // Verbatim from App.tsx import line
    expect(src).toContain("detectErrorEnvelope");
    // Verbatim from App.tsx import line
    expect(src).toContain("ServerErrorScreen");
    // Verbatim from App.tsx import source
    expect(src).toContain("@agntux/ui-primitives");
  });
});

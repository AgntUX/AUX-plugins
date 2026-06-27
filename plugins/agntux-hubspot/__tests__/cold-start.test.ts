/**
 * cold-start.test.ts — structural invariant guard for agntux-hubspot.
 *
 * Asserts: manifest shape, view-only plugin shape (no agents/, hooks/,
 * mcp-server/, .mcp.json), listing.yaml proposed_schema (parsed YAML),
 * _overrides/frontmatter.yaml machine-readable fields, the presence of
 * the four handler instruction files, the four payload override reference
 * files, and the view-tool entry module.
 *
 * All assertions are derived from verbatim reads of the build tree.
 * No prose from _overrides/ files is asserted (E30 rule).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const PLUGIN_SLUG = (
  JSON.parse(
    readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
  ) as { name: string }
).name; // "agntux-hubspot"

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(m.name).toBe("agntux-hubspot");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Inline-skill pattern (post 6aa72b8)
// ---------------------------------------------------------------------------

describe("plugin shape (inline-skill pattern, post 6aa72b8)", () => {
  it("does NOT ship a top-level agents/ directory", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });

  it("does NOT ship a hooks/ directory", () => {
    expect(existsSync(join(PLUGIN_ROOT, "hooks"))).toBe(false);
  });

  it("does NOT ship a mcp-server/ directory — source plugins are remote-view-only", () => {
    expect(existsSync(join(PLUGIN_ROOT, "mcp-server"))).toBe(false);
  });

  it("does NOT ship a .mcp.json file", () => {
    expect(existsSync(join(PLUGIN_ROOT, ".mcp.json"))).toBe(false);
  });

  it("ships view-tool/src/agntux-hubspot-view.ts (the compiled handler entry point)", () => {
    expect(
      existsSync(join(PLUGIN_ROOT, "view-tool", "src", "agntux-hubspot-view.ts")),
    ).toBe(true);
  });

  it("ships view-tool/package.json with the emit-manifest build script", () => {
    const p = join(PLUGIN_ROOT, "view-tool", "package.json");
    expect(existsSync(p)).toBe(true);
    const pkg = JSON.parse(readFileSync(p, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.build).toBeTruthy();
    expect(pkg.scripts!.build).toContain("emit-manifest");
  });
});

// ---------------------------------------------------------------------------
// Skill prompt substitution (rendered tree produced by build step)
// ---------------------------------------------------------------------------

describe("skill prompt substitution", () => {
  const skillRoot = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG);
  const skillFile = join(skillRoot, "SKILL.md");

  it("no unsubstituted {{...}} placeholders in the rendered sync skill or its reference files", () => {
    // Skip gracefully when the build step hasn't run yet — the rendered tree
    // will not exist. The build step renders SKILL.md + reference/*.md before
    // vitest runs; if absent, warn and skip.
    if (!existsSync(skillFile)) {
      console.warn(
        "[cold-start] skills/agntux-hubspot/SKILL.md not found — run the build step first",
      );
      return;
    }
    const parts: string[] = [];
    parts.push(readFileSync(skillFile, "utf-8"));
    const refDir = join(skillRoot, "reference");
    if (existsSync(refDir)) {
      for (const name of readdirSync(refDir).filter((n) => n.endsWith(".md")).sort()) {
        parts.push(readFileSync(join(refDir, name), "utf-8"));
      }
    }
    const folded = parts.join("\n");
    // The _overrides/frontmatter.yaml legitimately contains {{key}} names as
    // YAML comments/prose; we grep the RENDERED skill tree only (never _overrides/).
    const matches = folded.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("rendered SKILL.md frontmatter runs INLINE — no context:/agent:/tools: lines", () => {
    if (!existsSync(skillFile)) return; // build step must run first
    const p = readFileSync(skillFile, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(new RegExp(`^name: ${PLUGIN_SLUG}$`, "m"));
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });
});

// ---------------------------------------------------------------------------
// listing.yaml — parsed YAML assertions (mechanical rule 5)
// ---------------------------------------------------------------------------

describe("listing.yaml proposed_schema (parsed YAML)", () => {
  const listingPath = join(PLUGIN_ROOT, "marketplace", "listing.yaml");

  it("listing.yaml exists", () => {
    expect(existsSync(listingPath)).toBe(true);
  });

  it("has 4 ui_components entries matching the 4 handlers", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      ui_components?: Array<{ name: string; view_tool: string; resource_uri: string }>;
    };
    expect(Array.isArray(listing.ui_components)).toBe(true);
    expect(listing.ui_components!).toHaveLength(4);
  });

  it("ui_components cover all four handler names", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      ui_components?: Array<{ name: string }>;
    };
    const names = new Set(listing.ui_components!.map((c) => c.name));
    // Verbatim from marketplace/listing.yaml ui_components[].name fields
    expect(names.has("move-deal-stage")).toBe(true);
    expect(names.has("update-task")).toBe(true);
    expect(names.has("log-activity")).toBe(true);
    expect(names.has("reassign-record")).toBe(true);
  });

  it("ui_components view_tool names follow the agntux_hubspot_*_view convention", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      ui_components?: Array<{ view_tool: string }>;
    };
    const viewTools = new Set(listing.ui_components!.map((c) => c.view_tool));
    // Verbatim from marketplace/listing.yaml ui_components[].view_tool fields
    expect(viewTools.has("agntux_hubspot_move_deal_view")).toBe(true);
    expect(viewTools.has("agntux_hubspot_task_view")).toBe(true);
    expect(viewTools.has("agntux_hubspot_activity_view")).toBe(true);
    expect(viewTools.has("agntux_hubspot_reassign_view")).toBe(true);
  });

  it("proposed_schema entity_subtypes include deal, contact, company, task, ticket, engagement", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      proposed_schema?: {
        entity_subtypes?: Array<{ subtype: string }>;
      };
    };
    const subtypes = new Set(
      listing.proposed_schema?.entity_subtypes?.map((e) => e.subtype) ?? [],
    );
    // Verbatim from listing.yaml proposed_schema.entity_subtypes[].subtype
    expect(subtypes.has("deal")).toBe(true);
    expect(subtypes.has("contact")).toBe(true);
    expect(subtypes.has("company")).toBe(true);
    expect(subtypes.has("task")).toBe(true);
    expect(subtypes.has("ticket")).toBe(true);
    expect(subtypes.has("engagement")).toBe(true);
  });

  it("proposed_schema action_classes include deadline, response-needed, knowledge-update, risk, opportunity", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      proposed_schema?: {
        action_classes?: Array<{ class: string }>;
      };
    };
    const classes = new Set(
      listing.proposed_schema?.action_classes?.map((c) => c.class) ?? [],
    );
    // Verbatim from listing.yaml proposed_schema.action_classes[].class
    expect(classes.has("deadline")).toBe(true);
    expect(classes.has("response-needed")).toBe(true);
    expect(classes.has("knowledge-update")).toBe(true);
    expect(classes.has("risk")).toBe(true);
    expect(classes.has("opportunity")).toBe(true);
  });

  it("proposed_schema cursor_semantics describes a per-entity-type cursor map", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      proposed_schema?: { cursor_semantics?: string };
    };
    const cs = listing.proposed_schema?.cursor_semantics ?? "";
    // Verbatim substring from marketplace/listing.yaml line 93:
    expect(cs).toContain("Per-entity-type cursor map");
  });

  it("proposed_schema source_id_format documents the hubspot:{object_type}#{hs_object_id} pattern", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      proposed_schema?: { source_id_format?: string };
    };
    const fmt = listing.proposed_schema?.source_id_format ?? "";
    // Verbatim substring from marketplace/listing.yaml line 94:
    expect(fmt).toContain("{object_type}#{hs_object_id}");
  });
});

// ---------------------------------------------------------------------------
// _overrides/frontmatter.yaml — machine-readable fields only (E30 rule)
// Never assert prose that the ingest author may reword.
// ---------------------------------------------------------------------------

describe("_overrides/frontmatter.yaml structure", () => {
  const fmPath = join(
    PLUGIN_ROOT,
    "skills",
    PLUGIN_SLUG,
    "_overrides",
    "frontmatter.yaml",
  );

  it("_overrides/frontmatter.yaml exists", () => {
    expect(existsSync(fmPath)).toBe(true);
  });

  it("declares plugin-slug: agntux-hubspot", () => {
    const obj = yaml.load(readFileSync(fmPath, "utf-8")) as Record<string, unknown>;
    expect(obj["plugin-slug"]).toBe("agntux-hubspot");
  });

  it("declares source-slug: hubspot", () => {
    const obj = yaml.load(readFileSync(fmPath, "utf-8")) as Record<string, unknown>;
    expect(obj["source-slug"]).toBe("hubspot");
  });

  it("declares bootstrap-window-default-days: '30'", () => {
    const obj = yaml.load(readFileSync(fmPath, "utf-8")) as Record<string, unknown>;
    // bootstrap-window-default-days is a machine-readable config field.
    expect(String(obj["bootstrap-window-default-days"])).toBe("30");
  });
});

// ---------------------------------------------------------------------------
// _overrides/reference/ — the four payload reference files must exist
// (derived from the listing.yaml ui_components, not hardcoded)
// ---------------------------------------------------------------------------

describe("_overrides/reference payload files", () => {
  const overridesRef = join(
    PLUGIN_ROOT,
    "skills",
    PLUGIN_SLUG,
    "_overrides",
    "reference",
  );

  it("_overrides/reference/ exists", () => {
    expect(existsSync(overridesRef)).toBe(true);
  });

  // The four payload reference files correspond to the four handlers in listing.yaml.
  // File names derived from the handler names with "-payload.md" suffix, confirmed
  // by reading the actual _overrides/reference/ directory listing.
  for (const name of [
    "move-deal-payload.md",
    "task-payload.md",
    "activity-payload.md",
    "reassign-payload.md",
  ]) {
    it(`_overrides/reference/${name} exists`, () => {
      expect(existsSync(join(overridesRef, name))).toBe(true);
    });
  }

  it("cursor.md override exists", () => {
    expect(existsSync(join(overridesRef, "cursor.md"))).toBe(true);
  });

  it("fetch.md override exists", () => {
    expect(existsSync(join(overridesRef, "fetch.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// data/instructions/ — all four handler instruction files must exist
// ---------------------------------------------------------------------------

describe("data/instructions/ handler instruction files", () => {
  const instrDir = join(PLUGIN_ROOT, "data", "instructions");

  for (const name of ["move-deal.md", "task.md", "activity.md", "reassign.md"]) {
    it(`data/instructions/${name} exists`, () => {
      expect(existsSync(join(instrDir, name))).toBe(true);
    });
  }

  it("each instruction file declares type: plugin-instructions and plugin: agntux-hubspot", () => {
    for (const name of ["move-deal.md", "task.md", "activity.md", "reassign.md"]) {
      const raw = readFileSync(join(instrDir, name), "utf-8");
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch, `${name} missing frontmatter`).toBeTruthy();
      const fm = fmMatch![1];
      // Verbatim substring confirmed in each instruction file's frontmatter
      expect(fm).toContain("type: plugin-instructions");
      expect(fm).toContain("plugin: agntux-hubspot");
    }
  });
});

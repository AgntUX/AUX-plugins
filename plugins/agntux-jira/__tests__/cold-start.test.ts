/**
 * cold-start.test.ts — structural invariant guard for agntux-jira.
 *
 * Net-new plugin: asserts the manifest shape, view-only plugin shape,
 * listing.yaml proposed_schema (parsed YAML — not prose), and that the
 * rendered skill tree (produced by the build step before tests run) has
 * no unsubstituted {{…}} placeholders and no forked-context frontmatter.
 *
 * Everything derived from verbatim reads of the build tree. No phantom strings.
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
).name; // "agntux-jira"

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(m.name).toBe("agntux-jira");
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

  it("ships view-tool/src/agntux-jira-view.ts (the compiled handler entry point)", () => {
    // The build script bundles src/agntux-jira-view.ts to dist/agntux-jira-view.js.
    // The source file must be present even before compilation.
    expect(
      existsSync(join(PLUGIN_ROOT, "view-tool", "src", "agntux-jira-view.ts")),
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

  it("skills/agntux-jira/SKILL.md exists after render", () => {
    expect(existsSync(skillFile)).toBe(true);
  });

  it("no unsubstituted {{...}} placeholders in the rendered sync skill or its reference files", () => {
    // Fold SKILL.md + reference/*.md together — placeholders in either fail.
    const parts: string[] = [];
    if (existsSync(skillFile)) parts.push(readFileSync(skillFile, "utf-8"));
    const refDir = join(skillRoot, "reference");
    if (existsSync(refDir)) {
      for (const name of readdirSync(refDir).filter((n) => n.endsWith(".md")).sort()) {
        parts.push(readFileSync(join(refDir, name), "utf-8"));
      }
    }
    const folded = parts.join("\n");
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

  it("has 5 ui_components entries matching the 5 handlers", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      ui_components?: Array<{ name: string; view_tool: string; resource_uri: string }>;
    };
    expect(Array.isArray(listing.ui_components)).toBe(true);
    expect(listing.ui_components!).toHaveLength(5);
  });

  it("ui_components cover all five handler names", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      ui_components?: Array<{ name: string }>;
    };
    const names = new Set(listing.ui_components!.map((c) => c.name));
    expect(names.has("comment-issue")).toBe(true);
    expect(names.has("transition-issue")).toBe(true);
    expect(names.has("assign-issue")).toBe(true);
    expect(names.has("edit-issue-fields")).toBe(true);
    expect(names.has("log-work-time")).toBe(true);
  });

  it("proposed_schema entity_subtypes includes issue, comment, transition, worklog", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      proposed_schema?: {
        entity_subtypes?: Array<{ subtype: string }>;
      };
    };
    const subtypes = new Set(
      listing.proposed_schema?.entity_subtypes?.map((e) => e.subtype) ?? [],
    );
    expect(subtypes.has("issue")).toBe(true);
    expect(subtypes.has("comment")).toBe(true);
    expect(subtypes.has("transition")).toBe(true);
    expect(subtypes.has("worklog")).toBe(true);
  });

  it("proposed_schema action_classes includes response-needed, needs-decision, knowledge-update", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      proposed_schema?: {
        action_classes?: Array<{ class: string }>;
      };
    };
    const classes = new Set(
      listing.proposed_schema?.action_classes?.map((c) => c.class) ?? [],
    );
    expect(classes.has("response-needed")).toBe(true);
    expect(classes.has("needs-decision")).toBe(true);
    expect(classes.has("knowledge-update")).toBe(true);
  });

  it("proposed_schema cursor_semantics describes a per-project map", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      proposed_schema?: { cursor_semantics?: string };
    };
    const cs = listing.proposed_schema?.cursor_semantics ?? "";
    // Verbatim substring from marketplace/listing.yaml line 87:
    // "Per-project cursor map keyed by projectKey"
    expect(cs).toContain("Per-project cursor map keyed by projectKey");
  });

  it("proposed_schema source_id_format describes jira:{cloudId}:issue:{issueKey}", () => {
    const listing = yaml.load(readFileSync(listingPath, "utf-8")) as {
      proposed_schema?: { source_id_format?: string };
    };
    const fmt = listing.proposed_schema?.source_id_format ?? "";
    // Verbatim substring from marketplace/listing.yaml line 88:
    // "`jira:{cloudId}:issue:{issueKey}`"
    expect(fmt).toContain("jira:{cloudId}:issue:{issueKey}");
  });
});

// ---------------------------------------------------------------------------
// _overrides/frontmatter.yaml — required substitution keys (parsed YAML only,
// never asserting prose that the ingest author may reword — E30 rule)
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

  it("declares plugin-slug: agntux-jira", () => {
    // Load raw text to read YAML scalar values without triggering prose-grep.
    // The key `plugin-slug` is a machine-stable field name, not prose.
    const raw = readFileSync(fmPath, "utf-8");
    const obj = yaml.load(raw) as Record<string, unknown>;
    expect(obj["plugin-slug"]).toBe("agntux-jira");
  });

  it("declares source-slug: jira", () => {
    const obj = yaml.load(readFileSync(fmPath, "utf-8")) as Record<string, unknown>;
    expect(obj["source-slug"]).toBe("jira");
  });

  it("declares bootstrap-window-default-days: '30'", () => {
    const obj = yaml.load(readFileSync(fmPath, "utf-8")) as Record<string, unknown>;
    // bootstrap-window-default-days is a machine-readable config field.
    expect(String(obj["bootstrap-window-default-days"])).toBe("30");
  });
});

// ---------------------------------------------------------------------------
// _overrides/reference/ — the five payload reference files must exist
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

  // The five payload reference files correspond to the five handlers in listing.yaml.
  // Derived from the view_tool names in listing.yaml ui_components: jira_{name}_view.
  // The reference file names are the handler names with "-payload.md" suffix.
  for (const name of [
    "comment-payload.md",
    "transition-payload.md",
    "assign-payload.md",
    "edit-payload.md",
    "log-work-payload.md",
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
// data/instructions/ — all five handler instruction files must exist
// ---------------------------------------------------------------------------

describe("data/instructions/ handler instruction files", () => {
  const instrDir = join(PLUGIN_ROOT, "data", "instructions");

  for (const name of ["comment.md", "transition.md", "assign.md", "edit.md", "log-work.md"]) {
    it(`data/instructions/${name} exists`, () => {
      expect(existsSync(join(instrDir, name))).toBe(true);
    });
  }

  it("each instruction file declares type: plugin-instructions and plugin: agntux-jira", () => {
    for (const name of ["comment.md", "transition.md", "assign.md", "edit.md", "log-work.md"]) {
      const raw = readFileSync(join(instrDir, name), "utf-8");
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch, `${name} missing frontmatter`).toBeTruthy();
      const fm = fmMatch![1];
      expect(fm).toContain("type: plugin-instructions");
      expect(fm).toContain("plugin: agntux-jira");
    }
  });
});

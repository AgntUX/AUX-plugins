// =============================================================================
// cold-start.test.ts — plugin shape contract for agntux-stripe.
//
// Asserts the inline-skill pattern (post 6aa72b8), manifest fields, listing
// proposed_schema, and placeholder substitution completeness.
//
// All assertions are grounded in:
//   1. plugin.json / listing.yaml (parsed machine-readable fields)
//   2. The rendered skills/agntux-stripe/SKILL.md + reference/ tree
//
// NEVER reads _overrides/ or _overrides/**/*.yaml for content assertions
// (E30 rule — those files legitimately name {{key}} patterns in prose/comments).
// =============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const SLUG = "agntux-stripe";

// ── Manifest ──────────────────────────────────────────────────────────────────

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json lines 2, 3, 10
    expect(m.name).toBe(SLUG);
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
  });

  it("plugin.json recommended_ingest_cadence is the authored value", () => {
    const m = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"),
    );
    // Verbatim from .claude-plugin/plugin.json line 10
    expect(m.recommended_ingest_cadence).toBe("Every 60 min, 7am–7pm weekdays local");
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

  it("ships a view-tool/ directory — this is a UI-bearing plugin with six handlers", () => {
    expect(existsSync(join(PLUGIN_ROOT, "view-tool"))).toBe(true);
  });
});

// ── listing.yaml proposed_schema ─────────────────────────────────────────────
// All assertions use verbatim substrings read-and-copied from
// marketplace/listing.yaml (golden rule: read-then-copy-literal).
// No text-regex is used for field-name assertions (mechanical rule 5).

describe("listing.yaml proposed_schema", () => {
  function loadListing(): string {
    return readFileSync(join(PLUGIN_ROOT, "marketplace/listing.yaml"), "utf-8");
  }

  it("cursor_semantics field documents the scalar low-water-mark strategy", () => {
    const listing = loadListing();
    // Verbatim substring from marketplace/listing.yaml line 103
    expect(listing).toContain(
      "Stripe objects have `created` timestamps; a cursor advances to track new objects each sync.",
    );
  });

  it("source_id_format field documents the Stripe object-id prefix convention", () => {
    const listing = loadListing();
    // Two stable ASCII fragments from marketplace/listing.yaml line 104
    // (avoiding the em-dash per mechanical rule 3 — use two toContain checks instead).
    expect(listing).toContain("`{resource_type}#{object_id}`");
    expect(listing).toContain("Stripe object IDs are prefixed by type (e.g. `pi_`, `ch_`, `in_`");
  });

  it("entity subtypes include stripe-payment", () => {
    const listing = loadListing();
    // Verbatim from marketplace/listing.yaml line 70
    expect(listing).toContain("subtype: stripe-payment");
  });

  it("entity subtypes include stripe-invoice", () => {
    const listing = loadListing();
    // Verbatim from marketplace/listing.yaml line 73
    expect(listing).toContain("subtype: stripe-invoice");
  });

  it("entity subtypes include stripe-subscription", () => {
    const listing = loadListing();
    // Verbatim from marketplace/listing.yaml line 76
    expect(listing).toContain("subtype: stripe-subscription");
  });

  it("entity subtypes include stripe-dispute", () => {
    const listing = loadListing();
    // Verbatim from marketplace/listing.yaml line 82
    expect(listing).toContain("subtype: stripe-dispute");
  });

  it("action classes include response-needed (for disputes)", () => {
    const listing = loadListing();
    // Verbatim from marketplace/listing.yaml line 93
    expect(listing).toContain("class: response-needed");
  });

  it("action classes include risk (for failed payments / lost disputes)", () => {
    const listing = loadListing();
    // Verbatim from marketplace/listing.yaml line 96
    expect(listing).toContain("class: risk");
  });

  it("action classes include deadline (for invoice and trial deadlines)", () => {
    const listing = loadListing();
    // Verbatim from marketplace/listing.yaml line 91
    expect(listing).toContain("class: deadline");
  });

  it("listing.yaml declares six ui_components", () => {
    const listing = loadListing();
    // Count occurrences of '- name:' inside ui_components block.
    // Derived from listing.yaml lines 25–54 (six named components).
    const matches = listing.match(/^\s+- name: /gm);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(6);
  });

  it("listing.yaml declares all six view_tool names", () => {
    const listing = loadListing();
    // Verbatim view_tool values from marketplace/listing.yaml
    expect(listing).toContain("view_tool: agntux_stripe_refund_view");
    expect(listing).toContain("view_tool: agntux_stripe_dispute_view");
    expect(listing).toContain("view_tool: agntux_stripe_invoice_finalize_view");
    expect(listing).toContain("view_tool: agntux_stripe_invoice_void_view");
    expect(listing).toContain("view_tool: agntux_stripe_subscription_edit_view");
    expect(listing).toContain("view_tool: agntux_stripe_subscription_cancel_view");
  });
});

// ── Skill prompt substitution ─────────────────────────────────────────────────
// Mechanical rule 4: check SKILL.md + reference/*.md; NEVER _overrides/.

describe("skill prompt substitution", () => {
  const SKILL_PATH = join(PLUGIN_ROOT, `skills/${SLUG}/SKILL.md`);

  it("rendered SKILL.md exists (must be built before gate runs)", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it("no unsubstituted {{...}} placeholders in the rendered sync skill", () => {
    if (!existsSync(SKILL_PATH)) return; // skip if not yet rendered
    const skill = readFileSync(SKILL_PATH, "utf-8");
    const matches = skill.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("rendered SKILL.md frontmatter runs INLINE — no context:/agent:/tools: lines", () => {
    if (!existsSync(SKILL_PATH)) return;
    const p = readFileSync(SKILL_PATH, "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(new RegExp(`^name: ${SLUG}$`, "m"));
    expect(fm).not.toMatch(/^context:/m);
    expect(fm).not.toMatch(/^agent:/m);
    expect(fm).not.toMatch(/^tools:/m);
  });

  it("rendered reference files have no unsubstituted {{...}} placeholders", () => {
    const refDir = join(PLUGIN_ROOT, `skills/${SLUG}/reference`);
    if (!existsSync(refDir)) return;
    const refs: string[] = readdirSync(refDir).filter((n: string) =>
      n.endsWith(".md"),
    );
    for (const name of refs) {
      const text = readFileSync(join(refDir, name), "utf-8");
      const hits = text.match(/\{\{[a-z-]+\}\}/g);
      expect(hits, `{{placeholder}} found in reference/${name}`).toBeNull();
    }
  });
});

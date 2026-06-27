/**
 * connector-envelope.test.ts — connector-dispatch guard for agntux-hubspot.
 *
 * Each of the 4 UI handlers dispatches to the HubSpot Connector via a
 * connector-targeted envelope. The envelope builders live at:
 *
 *   view-tool/src/apps/{handler}/lib/build-envelope.ts
 *
 * All MCP tool names and function names derived verbatim from reading:
 *   - view-tool/src/apps/move-deal/lib/build-envelope.ts
 *   - view-tool/src/apps/task/lib/build-envelope.ts
 *   - view-tool/src/apps/activity/lib/build-envelope.ts
 *   - view-tool/src/apps/reassign/lib/build-envelope.ts
 *
 * No prose from _overrides/ files is asserted (E30 rule). Tool name strings
 * are read directly from the envelope builder source and are stable API
 * identifiers, not reworded prose.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VIEW_SRC = join(PLUGIN_ROOT, "view-tool", "src");

// ---------------------------------------------------------------------------
// Envelope builder registry
// Derived verbatim from reading each build-envelope.ts file.
// ---------------------------------------------------------------------------

const ENVELOPE_BUILDERS: Array<{
  handler: string;
  path: string;
  // Tool name confirmed by reading the build-envelope.ts const TOOL line
  mcpTool: string;
  // Export function names confirmed by reading the build-envelope.ts file
  fnNames: string[];
}> = [
  {
    handler: "move-deal",
    path: join(VIEW_SRC, "apps", "move-deal", "lib", "build-envelope.ts"),
    // From view-tool/src/apps/move-deal/lib/build-envelope.ts:
    //   const TOOL = "mcp__hubspot__manage_crm_objects";
    mcpTool: "mcp__hubspot__manage_crm_objects",
    // From build-envelope.ts: export function buildMoveDealEnvelope
    fnNames: ["buildMoveDealEnvelope"],
  },
  {
    handler: "task",
    path: join(VIEW_SRC, "apps", "task", "lib", "build-envelope.ts"),
    // From view-tool/src/apps/task/lib/build-envelope.ts:
    //   const TOOL = "mcp__hubspot__manage_crm_objects";
    mcpTool: "mcp__hubspot__manage_crm_objects",
    // From build-envelope.ts: two exported functions (complete + reschedule)
    fnNames: ["buildCompleteTaskEnvelope", "buildRescheduleTaskEnvelope"],
  },
  {
    handler: "activity",
    path: join(VIEW_SRC, "apps", "activity", "lib", "build-envelope.ts"),
    // From view-tool/src/apps/activity/lib/build-envelope.ts:
    //   const TOOL = "mcp__hubspot__manage_crm_objects";
    mcpTool: "mcp__hubspot__manage_crm_objects",
    // From build-envelope.ts: export function buildLogNoteEnvelope
    fnNames: ["buildLogNoteEnvelope"],
  },
  {
    handler: "reassign",
    path: join(VIEW_SRC, "apps", "reassign", "lib", "build-envelope.ts"),
    // From view-tool/src/apps/reassign/lib/build-envelope.ts:
    //   const TOOL = "mcp__hubspot__manage_crm_objects";
    mcpTool: "mcp__hubspot__manage_crm_objects",
    // From build-envelope.ts: export function buildReassignEnvelope
    fnNames: ["buildReassignEnvelope"],
  },
];

// ---------------------------------------------------------------------------
// Envelope builders exist
// ---------------------------------------------------------------------------

describe("connector-envelope dispatch — envelope builders exist", () => {
  for (const { handler, path } of ENVELOPE_BUILDERS) {
    it(`${handler}: build-envelope.ts exists at view-tool/src/apps/${handler}/lib/build-envelope.ts`, () => {
      expect(
        existsSync(path),
        `Missing envelope builder for handler "${handler}" — expected at ${path}`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// HubSpot Connector tool name is referenced in each builder
// ---------------------------------------------------------------------------

describe("connector-envelope dispatch — HubSpot Connector tool name is referenced", () => {
  for (const { handler, path, mcpTool } of ENVELOPE_BUILDERS) {
    it(`${handler}: envelope builder references ${mcpTool}`, () => {
      if (!existsSync(path)) {
        throw new Error(
          `build-envelope.ts for "${handler}" not found at ${path} — author it before running tests`,
        );
      }
      const src = readFileSync(path, "utf-8");
      expect(
        src,
        `${handler}/build-envelope.ts must reference "${mcpTool}"`,
      ).toContain(mcpTool);
    });
  }
});

// ---------------------------------------------------------------------------
// Each exported function name is present in the builder source
// ---------------------------------------------------------------------------

describe("connector-envelope dispatch — builder functions are exported", () => {
  for (const { handler, path, fnNames } of ENVELOPE_BUILDERS) {
    for (const fnName of fnNames) {
      it(`${handler}: envelope builder exports/defines ${fnName}`, () => {
        if (!existsSync(path)) {
          throw new Error(
            `build-envelope.ts for "${handler}" not found — author it first`,
          );
        }
        const src = readFileSync(path, "utf-8");
        expect(
          src,
          `${handler}/build-envelope.ts must define or export "${fnName}"`,
        ).toContain(fnName);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// NO_NATIVE_UI suppression directive is present in each builder
// ---------------------------------------------------------------------------

describe("connector-envelope dispatch — envelopes suppress native HubSpot UI", () => {
  for (const { handler, path } of ENVELOPE_BUILDERS) {
    it(`${handler}: envelope text carries the NO_NATIVE_UI suppression directive`, () => {
      if (!existsSync(path)) {
        throw new Error(`build-envelope.ts for "${handler}" not found`);
      }
      const src = readFileSync(path, "utf-8");
      // The directive is one of: IMPORTANT, NO_NATIVE_UI, or "Do NOT render"
      // Confirmed verbatim in each build-envelope.ts via the NO_NATIVE_UI_DIRECTIVE
      // constant (all four files use the same "IMPORTANT NO_NATIVE_UI" pattern).
      const hasDirective =
        src.includes("IMPORTANT") ||
        src.includes("NO_NATIVE_UI") ||
        src.includes("Do NOT render");
      expect(
        hasDirective,
        `${handler}/build-envelope.ts must include the NO_NATIVE_UI suppression directive`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// agntux-hubspot-view.ts — main handler module exports all 4 view tools
// (view_tool names derived from listing.yaml ui_components[].view_tool)
// ---------------------------------------------------------------------------

describe("agntux-hubspot-view.ts — 4-handler module contract", () => {
  const viewModulePath = join(VIEW_SRC, "agntux-hubspot-view.ts");

  it("view-tool/src/agntux-hubspot-view.ts exists", () => {
    expect(existsSync(viewModulePath)).toBe(true);
  });

  it("agntux-hubspot-view.ts references all 4 view tool descriptor names", () => {
    if (!existsSync(viewModulePath)) {
      throw new Error("agntux-hubspot-view.ts not found");
    }
    const src = readFileSync(viewModulePath, "utf-8");
    // View tool names confirmed verbatim from listing.yaml ui_components[].view_tool
    // and from the descriptor name fields in agntux-hubspot-view.ts:
    for (const name of [
      "agntux_hubspot_move_deal_view",
      "agntux_hubspot_task_view",
      "agntux_hubspot_activity_view",
      "agntux_hubspot_reassign_view",
    ]) {
      expect(src, `agntux-hubspot-view.ts must reference "${name}"`).toContain(name);
    }
  });

  it("agntux-hubspot-view.ts exports a viewTools array (default export)", () => {
    if (!existsSync(viewModulePath)) return;
    const src = readFileSync(viewModulePath, "utf-8");
    // Confirmed verbatim in agntux-hubspot-view.ts: "viewTools: ["
    expect(src).toContain("viewTools:");
    // Confirmed verbatim: "export default mod;"
    expect(src).toContain("export default mod");
  });
});

// ---------------------------------------------------------------------------
// manage_crm_objects is the single connector tool for all four handlers
// (all builders commit via the same HubSpot manage_crm_objects tool)
// ---------------------------------------------------------------------------

describe("connector tool consistency — all handlers use manage_crm_objects", () => {
  it("every build-envelope.ts references mcp__hubspot__manage_crm_objects", () => {
    for (const { handler, path } of ENVELOPE_BUILDERS) {
      if (!existsSync(path)) continue;
      const src = readFileSync(path, "utf-8");
      expect(
        src,
        `${handler}/build-envelope.ts must reference "mcp__hubspot__manage_crm_objects"`,
      ).toContain("mcp__hubspot__manage_crm_objects");
    }
  });

  it("no handler references a different connector (Atlassian, Linear, Slack, etc.)", () => {
    const disallowedPrefixes = [
      "mcp__claude_ai_Atlassian",
      "mcp__linear",
      "mcp__slack",
    ];
    for (const { handler, path } of ENVELOPE_BUILDERS) {
      if (!existsSync(path)) continue;
      const src = readFileSync(path, "utf-8");
      for (const prefix of disallowedPrefixes) {
        expect(
          src.includes(prefix),
          `${handler}/build-envelope.ts must not reference connector prefix "${prefix}"`,
        ).toBe(false);
      }
    }
  });
});

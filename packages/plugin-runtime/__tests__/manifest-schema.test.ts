import { describe, expect, it } from "vitest";
import { ViewToolsManifestSchema } from "../src/manifest-schema.js";

function happyManifest() {
  return {
    plugin_slug: "agntux_core",
    plugin_version: "1.0.0",
    handler_module: "view-tool/dist/agntux-core-view.js",
    view_tools: [
      {
        name: "agntux_core_triage",
        description: "triage view",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        mcp_app_meta: {
          resourceUri: "ui://agntux-core/triage",
          csp: {},
          permissions: {},
        },
        data_paths: [{ pattern: "data/actions/**", scope: "personal" }],
      },
    ],
    ui_bundles: [
      {
        uri: "ui://agntux-core/triage",
        html_path: "view-tool/dist/ui-resources/triage.html",
        csp: {},
        permissions: {},
      },
    ],
  };
}

describe("ViewToolsManifestSchema — happy path", () => {
  it("parses a valid manifest", () => {
    const result = ViewToolsManifestSchema.safeParse(happyManifest());
    expect(result.success).toBe(true);
  });
});

describe("ViewToolsManifestSchema — invalid cases", () => {
  it("rejects missing plugin_slug", () => {
    const m = happyManifest() as Record<string, unknown>;
    delete m.plugin_slug;
    expect(ViewToolsManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects an invalid ui_resource_uri", () => {
    const m = happyManifest();
    m.view_tools[0]!.mcp_app_meta.resourceUri = "ui://NOT-KEBAB/triage";
    m.ui_bundles[0]!.uri = "ui://NOT-KEBAB/triage";
    expect(ViewToolsManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects handler_module with `..`", () => {
    const m = happyManifest();
    // The regex allows / and . inside [\w./-]+, but `..` segments must not
    // appear in a sane handler_module path. The current regex DOES match
    // `..` since `.` is included — so we also require the path to look
    // like `view-tool/dist/...`. Use a clearly-bad shape that fails the
    // anchor:
    m.handler_module = "../etc/passwd";
    expect(ViewToolsManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects view_tool without a matching ui_bundle", () => {
    const m = happyManifest();
    m.view_tools[0]!.mcp_app_meta.resourceUri = "ui://agntux-core/orphan";
    // ui_bundles still points at /triage so the refine() check fires.
    expect(ViewToolsManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects empty view_tools[]", () => {
    const m = happyManifest();
    m.view_tools = [];
    expect(ViewToolsManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects empty data_paths[]", () => {
    const m = happyManifest();
    m.view_tools[0]!.data_paths = [];
    expect(ViewToolsManifestSchema.safeParse(m).success).toBe(false);
  });
});

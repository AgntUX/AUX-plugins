// Integration tests for the in-process view-tool loader.
//
// Load agntux-slack's compiled view-tool bundle and assert the loader's
// listTools / readResource / callTool shims match the contract the host
// page (and Playwright) depends on. Skips gracefully if the bundle is
// missing (fresh clone before build).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadViewToolModule, callToolWithUi } from "../src/mcp-bridge.mjs";

const PLUGIN_ROOT = join(import.meta.dirname, "..", "..", "..", "agntux-slack");
const BUNDLE = join(PLUGIN_ROOT, "view-tool", "dist", "agntux-slack-view.js");
const MANIFEST = join(PLUGIN_ROOT, "view-tool", "dist", "view-tools.manifest.json");

const skip = !existsSync(BUNDLE) || !existsSync(MANIFEST);

describe.skipIf(skip)("loadViewToolModule — agntux-slack integration", () => {
  it("loads the compiled module and exposes view tools", async () => {
    const loader = await loadViewToolModule(PLUGIN_ROOT);
    const { tools } = loader.listTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    const compose = tools.find((t) => t.name === "agntux_slack_compose_view");
    expect(compose, "compose view tool present").toBeTruthy();
    expect(compose.description).toMatch(/Slack/i);
    expect(compose.inputSchema).toBeTruthy();
    expect(compose._meta?.ui?.resourceUri).toBe("ui://agntux-slack/compose");
  });

  it("reads the iframe HTML resource by ui:// URI", async () => {
    const loader = await loadViewToolModule(PLUGIN_ROOT);
    const { contents } = loader.readResource({
      uri: "ui://agntux-slack/compose",
    });
    expect(contents.length).toBe(1);
    expect(contents[0].mimeType).toBe("text/html");
    expect(contents[0].text).toMatch(/^<!doctype html|^<html/i);
    expect(contents[0]._meta?.ui?.csp).toBeTruthy();
    expect(contents[0]._meta?.ui?.permissions).toBeTruthy();
  });

  it("throws a clear error for an unknown ui:// URI", async () => {
    const loader = await loadViewToolModule(PLUGIN_ROOT);
    expect(() => loader.readResource({ uri: "ui://does-not-exist/foo" }))
      .toThrowError(/UI resource not registered in manifest/);
  });

  it("invokes the view-tool handler with ctx.fs backed by fixtures", async () => {
    const loader = await loadViewToolModule(PLUGIN_ROOT);
    // No action_id resolves → handler returns a graceful 'error' payload,
    // NOT a thrown exception. The shape proves the dispatch path works.
    const result = await loader.callTool({
      name: "agntux_slack_compose_view",
      arguments: { action_id: "does-not-exist" },
    });
    expect(result).toBeTruthy();
    expect(result.structuredContent).toBeTruthy();
    expect(typeof result.structuredContent).toBe("object");
  });

  it("callToolWithUi resolves both the tool result and the UI resource", async () => {
    const loader = await loadViewToolModule(PLUGIN_ROOT);
    const { toolResult, uiResource } = await callToolWithUi(
      loader,
      "agntux_slack_compose_view",
      { action_id: "does-not-exist" },
    );
    expect(toolResult.structuredContent).toBeTruthy();
    expect(uiResource).toBeTruthy();
    expect(uiResource.html).toMatch(/^<!doctype html|^<html/i);
    expect(uiResource.csp).toBeTruthy();
  });

  it("rejects an unknown plugin root with a helpful error", async () => {
    await expect(loadViewToolModule("/tmp/does-not-exist")).rejects.toThrow(
      /Plugin manifest not found/,
    );
  });

  it("rejects a plugin with no view-tool/dist build", async () => {
    // agntux-build itself ships no view-tool — perfect negative fixture.
    const agntuxBuildRoot = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "agntux-build",
    );
    await expect(loadViewToolModule(agntuxBuildRoot)).rejects.toThrow(
      /view-tool not built at/,
    );
  });
});

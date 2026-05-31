// View-tool loader — loads the plugin's compiled view-tool ESM module
// in-process and exposes `listTools`, `readResource`, and `callTool`
// against it. Replaces the legacy "spawn the plugin's MCP server in
// HTTP mode" path; source plugins under the view-only shape ship no
// local MCP server, so there is nothing to spawn.
//
// Mutation tool calls (the ones the iframe makes via
// `useAppsClient().callTool()`) are NOT routed through here — they
// hit `/api/intercept-tool-call` in `server.mjs` so the host-renderer
// can stub + log them without firing real connector writes. The
// `callTool` exported here is reserved for the *initial* view-tool
// render: the read-only handler that produces `structuredContent` for
// the iframe to display.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// `createLocalFsContext` is intentionally NOT exported from
// `@agntux/plugin-runtime`'s root barrel (see the trust-model note in
// `packages/plugin-runtime/src/index.ts`); it lives on the explicit
// `local-fs` subpath the package's `exports` block whitelists for
// local-environment consumers like this renderer.
//
// It is loaded LAZILY with a vendored-path fallback so the renderer survives
// the shipped agntux-build bundle. There, the host-renderer's
// `@agntux/plugin-runtime` file: dep (`file:../../../packages/plugin-runtime`)
// resolves OUTSIDE the bundle, so `npm install` leaves a broken link and the
// bare import throws ERR_MODULE_NOT_FOUND (the Test-#4 render blocker). On that
// error we import the vendored copy at `host-renderer/vendor/plugin-runtime/
// dist/local-fs.js` by EXPLICIT path. NODE_PATH can't fix this — Node's ESM
// resolver ignores it for bare specifiers — but the vendored package.json marks
// "type":"module" (so the .js dist parses as ESM) and ships
// node_modules/{yaml,zod} so the runtime's transitive bare imports resolve via
// ESM walk-up. The normal bare import still wins in the maintainer clone / when
// the install succeeds.
let _createLocalFsContext;
async function getCreateLocalFsContext() {
  if (_createLocalFsContext) return _createLocalFsContext;
  try {
    ({ createLocalFsContext: _createLocalFsContext } = await import(
      "@agntux/plugin-runtime/local-fs"
    ));
  } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
    const vendored = pathToFileURL(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "vendor",
        "plugin-runtime",
        "dist",
        "local-fs.js",
      ),
    ).href;
    ({ createLocalFsContext: _createLocalFsContext } = await import(vendored));
  }
  return _createLocalFsContext;
}

/**
 * Load the plugin's compiled view-tool ESM module in-process and
 * return a client-shaped shim with `listTools`, `readResource`, and
 * `callTool`. No child process; no HTTP listen.
 *
 *   {
 *     listTools: () => { tools: Tool[] },
 *     readResource: ({ uri }) => { contents: [...] },
 *     callTool: ({ name, arguments }) => CallToolResult,
 *     close: () => void,         // no-op; kept for API parity
 *   }
 *
 * `fixturesDir` is the directory `ctx.fs` reads from when handlers
 * call e.g. `parseActionFile("actions/{id}.md")`. Defaults to the
 * plugin's `examples/` directory if present, else `__tests__/fixtures/`,
 * else the plugin root (which lets a handler return graceful
 * "no fixture" output instead of crashing).
 */
export async function loadViewToolModule(pluginRoot, { fixturesDir } = {}) {
  const root = resolve(pluginRoot);

  // Resolve the compiled handler module. agntux-{slug}/view-tool/dist/{slug}-view.js
  const pluginJsonPath = join(root, ".claude-plugin", "plugin.json");
  if (!existsSync(pluginJsonPath)) {
    throw new Error(
      `Plugin manifest not found at ${pluginJsonPath}. ` +
        `Pass --plugin pointing at a plugin root that contains .claude-plugin/plugin.json.`,
    );
  }
  const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
  const slug = pluginJson.name;
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error(`Plugin manifest at ${pluginJsonPath} has no "name" field.`);
  }

  const handlerEntry = join(root, "view-tool", "dist", `${slug}-view.js`);
  if (!existsSync(handlerEntry)) {
    throw new Error(
      `view-tool not built at ${handlerEntry}. ` +
        `Run \`npm run build\` inside ${root}/view-tool/ first.`,
    );
  }

  // Dynamic-import the handler. Same trick `emit-manifest.mjs` already
  // uses to load + introspect the compiled module.
  const mod = await import(pathToFileURL(handlerEntry).href);
  const viewTools = mod?.default?.viewTools;
  if (!Array.isArray(viewTools) || viewTools.length === 0) {
    throw new Error(
      `${handlerEntry} must default-export { viewTools: ViewTool[] } (non-empty)`,
    );
  }

  // Resolve manifest. Source of truth for ui_resource_uri + CSP + permissions.
  const manifestPath = join(root, "view-tool", "dist", "view-tools.manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `view-tools.manifest.json missing at ${manifestPath}. ` +
        `Run \`npm run build\` inside ${root}/view-tool/ first.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  // Pick the fixtures directory the ctx.fs reads will resolve against.
  const fixturesRoot = resolveFixturesRoot(root, fixturesDir);

  // Build the view-tool ctx. Scope is hard-coded for the local renderer —
  // real values get assigned server-side at deploy time. The factory is loaded
  // lazily (vendored-path fallback) so the renderer resolves it in the shipped
  // bundle as well as the maintainer clone.
  const createLocalFsContext = await getCreateLocalFsContext();
  const ctx = createLocalFsContext({
    root: fixturesRoot,
    scope: { user_id: "host-renderer", organization_id: "host-renderer" },
  });

  // Build a lookup from tool name → view-tool entry. Each compiled
  // ViewTool is `{ descriptor: { name, description, inputSchema,
  // outputSchema, ui_resource_uri, data_paths }, handle: (args, ctx) }`.
  const byName = new Map();
  for (const vt of viewTools) {
    if (typeof vt?.descriptor?.name !== "string") {
      throw new Error(
        `view-tool entry missing string descriptor.name (got ${JSON.stringify(vt?.descriptor)})`,
      );
    }
    byName.set(vt.descriptor.name, vt);
  }

  // Build the tools list in MCP `listTools` shape so the iframe bridge
  // works unchanged. We carry `_meta.ui.resourceUri` through so the host
  // page knows where to fetch the iframe HTML from.
  function listTools() {
    return {
      tools: viewTools.map((vt) => ({
        name: vt.descriptor.name,
        description: vt.descriptor.description ?? "",
        inputSchema:
          vt.descriptor.inputSchema ?? { type: "object", properties: {} },
        outputSchema: vt.descriptor.outputSchema,
        _meta: {
          "ui/resourceUri": vt.descriptor.ui_resource_uri,
          ui: { resourceUri: vt.descriptor.ui_resource_uri },
        },
      })),
    };
  }

  // Look up a UI bundle by its `ui://` URI. The manifest emitter
  // (`view-tool/scripts/emit-manifest.mjs`) writes the bundle entries
  // as `{ uri, html_path, csp, permissions }`. `html_path` is relative
  // to the plugin root (e.g. `view-tool/dist/ui-resources/triage.html`).
  function readResource({ uri }) {
    const bundle = (manifest.ui_bundles ?? []).find((b) => b.uri === uri);
    if (!bundle) {
      const known = (manifest.ui_bundles ?? [])
        .map((b) => b.uri)
        .join(", ");
      throw new Error(
        `UI resource not registered in manifest: ${uri}. Known: ${known}`,
      );
    }
    const htmlPath = join(root, bundle.html_path);
    if (!existsSync(htmlPath)) {
      throw new Error(`UI resource file not found on disk: ${htmlPath}`);
    }
    const html = readFileSync(htmlPath, "utf-8");
    return {
      contents: [
        {
          uri,
          mimeType: "text/html",
          text: html,
          _meta: {
            ui: {
              csp: bundle.csp,
              permissions: bundle.permissions,
            },
          },
        },
      ],
    };
  }

  async function callTool({ name, arguments: args }) {
    const vt = byName.get(name);
    if (!vt) {
      throw new Error(
        `Tool "${name}" not found. Available: ${[...byName.keys()].join(", ")}`,
      );
    }
    const result = await vt.handle(args ?? {}, ctx);
    return result;
  }

  return {
    listTools,
    readResource,
    callTool,
    pluginSlug: slug,
    fixturesRoot,
    close: () => {
      // no-op — in-process loader has nothing to tear down
    },
  };
}

/**
 * Helper for the headless render: full lifecycle in one call.
 *
 * Returns:
 *   {
 *     toolResult: CallToolResult,         // structuredContent + content + _meta
 *     uiResource: { html, csp, permissions } | null,  // null if no UI handler
 *   }
 */
export async function callToolWithUi(client, toolName, args) {
  const tools = await client.listTools();
  const tool = tools.tools.find((t) => t.name === toolName);
  if (!tool) {
    throw new Error(
      `Tool "${toolName}" not found. Available: ${tools.tools.map((t) => t.name).join(", ")}`,
    );
  }

  const uiResourceUri =
    tool._meta?.["ui/resourceUri"] || tool._meta?.ui?.resourceUri;

  // Run in parallel so the iframe CSP + permissions are ready by the
  // time the handler returns its structuredContent.
  const [toolResult, uiResource] = await Promise.all([
    client.callTool({ name: toolName, arguments: args ?? {} }),
    uiResourceUri ? readUiResource(client, uiResourceUri) : Promise.resolve(null),
  ]);

  return { toolResult, uiResource };
}

async function readUiResource(client, uri) {
  const resource = await client.readResource({ uri });
  const content = resource.contents?.[0];
  if (!content) {
    throw new Error(`Empty UI resource: ${uri}`);
  }
  const html =
    "blob" in content
      ? Buffer.from(content.blob, "base64").toString("utf-8")
      : content.text;
  const meta = content._meta || content.meta || {};
  return {
    html,
    csp: meta.ui?.csp || meta.csp,
    permissions: meta.ui?.permissions || meta.permissions,
  };
}

function resolveFixturesRoot(pluginRoot, override) {
  if (override) return resolve(override);
  const examples = join(pluginRoot, "examples");
  if (existsSync(examples)) return examples;
  const testFixtures = join(pluginRoot, "__tests__", "fixtures");
  if (existsSync(testFixtures)) return testFixtures;
  return pluginRoot;
}

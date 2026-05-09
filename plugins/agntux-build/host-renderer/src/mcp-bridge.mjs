// MCP bridge — spawns the plugin's MCP server in HTTP mode and exposes
// `listTools`, `readResource`, and `callTool` against it. Used by the
// host page's tool-call flow and by the headless `/__test/render`
// endpoint.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SERVER_BOOT_TIMEOUT_MS = 30_000;

/**
 * Spawn `mcp-server/dist/index.js` in HTTP mode on a random free port and
 * return the URL + a kill function.
 */
export async function spawnPluginMcp(pluginRoot, { port = 0 } = {}) {
  const root = resolve(pluginRoot);
  const entry = join(root, "mcp-server", "dist", "index.js");
  if (!existsSync(entry)) {
    throw new Error(
      `Plugin MCP server not built at ${entry}. ` +
        `Run \`node scripts/build-plugin.mjs <slug>\` first.`,
    );
  }

  // Port=0 lets the OS pick. The plugin's server typically reads `PORT`
  // and binds; if it doesn't honour PORT, the user's seeing a different
  // class of bug — fail loud.
  const env = {
    ...process.env,
    HTTP_MODE: "1",
    PORT: String(port),
    NODE_ENV: "test",
  };

  const child = spawn(process.execPath, [entry], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr = [];
  let listeningUrl = null;

  // Match any of these phrasings the plugin's MCP server might use:
  //   "listening on http://..."        (typical Express log)
  //   "listening at http://..."        (typical Node http log)
  //   "Server started on http://..."
  //   "MCP server listening at http://..."
  // We accept the FIRST URL after one of those keywords.
  const URL_ANNOUNCE_RE = /\b(?:listening|started|ready|serving)\s+(?:on|at)\s+(https?:\/\/\S+)/i;

  const onChunk = (text) => {
    if (listeningUrl) return;
    // Trim trailing punctuation (the URL might be followed by a period
    // or comma in the log line).
    const m = text.match(URL_ANNOUNCE_RE);
    if (m) listeningUrl = m[1].replace(/[),.;]+$/, "");
  };
  child.stdout.on("data", (buf) => onChunk(String(buf)));
  child.stderr.on("data", (buf) => {
    const text = String(buf);
    stderr.push(text);
    // Some plugin servers (notably the test scaffold) log to stderr.
    onChunk(text);
  });

  const start = Date.now();
  while (!listeningUrl && Date.now() - start < SERVER_BOOT_TIMEOUT_MS) {
    if (child.exitCode != null) {
      throw new Error(
        `Plugin MCP server exited (code ${child.exitCode}) before listening. ` +
          `stderr:\n${stderr.join("")}`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!listeningUrl) {
    child.kill("SIGTERM");
    throw new Error(
      `Plugin MCP server did not announce a listening URL within ` +
        `${SERVER_BOOT_TIMEOUT_MS}ms. Server must log "listening on http://..." ` +
        `to stdout when HTTP_MODE=1. stderr:\n${stderr.join("")}`,
    );
  }

  return {
    url: listeningUrl,
    kill: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // already dead
      }
    },
  };
}

/**
 * Connect an MCP client to a running plugin server.
 */
export async function connectClient(serverUrl) {
  const client = new Client({
    name: "agntux-build-host-renderer",
    version: "0.1.0",
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl)));
  return client;
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

  const uiResourceUri = tool._meta?.["ui/resourceUri"] || tool._meta?.ui?.resourceUri;

  // Fetch UI resource in parallel with tool call so CSP + permissions are
  // ready by the time the iframe is ready to receive them.
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
  const html = "blob" in content ? Buffer.from(content.blob, "base64").toString("utf-8") : content.text;
  const meta = content._meta || content.meta || {};
  return {
    html,
    csp: meta.ui?.csp || meta.csp,
    permissions: meta.ui?.permissions || meta.permissions,
  };
}

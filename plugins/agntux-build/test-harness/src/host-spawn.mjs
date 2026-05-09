// Spawn the in-plugin host-renderer in --headless mode and wait for
// its first stdout line — a JSON object `{ port, pluginMcpUrl }`.
// Returns { port, dispose }.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// host-renderer lives next to test-harness in the agntux-build plugin.
// In layout: plugins/agntux-build/{host-renderer,test-harness}/
const HOST_BIN_DEFAULT = resolve(__dirname, "..", "..", "host-renderer", "bin", "host.mjs");

const SPAWN_TIMEOUT_MS = 30_000;

export async function spawnHostRenderer({ pluginRoot, hostBin = HOST_BIN_DEFAULT }) {
  if (!existsSync(hostBin)) {
    throw new Error(
      `host-renderer not found at ${hostBin}. ` +
        `Pass --host-bin <path> if the host renderer lives elsewhere.`,
    );
  }
  if (!existsSync(join(pluginRoot, "mcp-server", "dist", "index.js"))) {
    throw new Error(
      `Plugin MCP server not built at ${pluginRoot}/mcp-server/dist/index.js. ` +
        `Run \`node scripts/build-plugin.mjs <slug>\` from the marketplace repo first.`,
    );
  }

  const child = spawn(
    process.execPath,
    [hostBin, "--plugin", pluginRoot, "--headless"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const stderr = [];
  child.stderr.on("data", (buf) => {
    const text = String(buf);
    stderr.push(text);
    if (process.env.AGNTUX_BUILD_TEST_DEBUG) {
      process.stderr.write(`[host:err] ${text}`);
    }
  });

  const announce = await new Promise((resolveP, rejectP) => {
    let buf = "";
    const onExit = (code) => {
      rejectP(
        new Error(
          `host-renderer exited (code ${code}) before announcing port. ` +
            `stderr:\n${stderr.join("")}`,
        ),
      );
    };
    const t = setTimeout(() => {
      child.removeListener("exit", onExit);
      child.kill("SIGTERM");
      rejectP(
        new Error(
          `host-renderer didn't announce port within ${SPAWN_TIMEOUT_MS}ms. ` +
            `stderr:\n${stderr.join("")}`,
        ),
      );
    }, SPAWN_TIMEOUT_MS);
    child.on("exit", onExit);
    child.stdout.on("data", (chunk) => {
      buf += String(chunk);
      const newlineIdx = buf.indexOf("\n");
      if (newlineIdx === -1) return;
      const line = buf.slice(0, newlineIdx).trim();
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.port === "number") {
          clearTimeout(t);
          child.removeListener("exit", onExit);
          resolveP(parsed);
        }
      } catch {
        // not JSON — ignore (host still starting up)
      }
    });
  });

  return {
    port: announce.port,
    pluginMcpUrl: announce.pluginMcpUrl,
    dispose: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // already dead
      }
      // hard kill after 2s if SIGTERM didn't take
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already dead
        }
      }, 2000).unref();
    },
  };
}

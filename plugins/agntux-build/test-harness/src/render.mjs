// Drive a single render against the in-plugin host-renderer's
// /__test/render endpoint. Writes the screenshot + metadata to disk
// and returns a summary the CLI prints.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { spawnHostRenderer } from "./host-spawn.mjs";

export async function runRender({
  pluginRoot,
  toolName,
  args,
  outDir,
  timeoutMs,
  hostBin,
}) {
  const absOut = resolve(outDir);
  await mkdir(absOut, { recursive: true });

  const host = await spawnHostRenderer({ pluginRoot, hostBin });
  try {
    const renderRes = await fetch(`http://localhost:${host.port}/__test/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolName, args, timeoutMs }),
    });

    if (!renderRes.ok) {
      const errorText = await renderRes.text();
      throw new Error(
        `/__test/render returned HTTP ${renderRes.status}: ${errorText}`,
      );
    }

    const result = await renderRes.json();

    // Persist the screenshot as a real PNG file.
    const screenshotPath = join(absOut, `${sanitiseToolName(toolName)}.png`);
    await writeFile(
      screenshotPath,
      Buffer.from(result.screenshotBase64, "base64"),
    );

    // Persist the metadata sidecar (without the screenshot bytes — that's
    // a separate file).
    const meta = {
      ...result,
      screenshotBase64: undefined,
      screenshotPath,
    };
    delete meta.screenshotBase64;
    const metaPath = join(absOut, `${sanitiseToolName(toolName)}.json`);
    await writeFile(metaPath, JSON.stringify(meta, null, 2));

    return {
      passed: result.passed,
      renderState: result.renderState,
      consoleErrorsCount: result.consoleErrors?.length ?? 0,
      contentChecks: result.contentChecks ?? null,
      screenshotPath,
      metaPath,
      structuredContent: result.structuredContent,
      toolError: result.toolError,
    };
  } finally {
    host.dispose();
  }
}

function sanitiseToolName(name) {
  // Keep alnum + underscore + dash; replace anything else.
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

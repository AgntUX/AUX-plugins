// Probe whether Playwright's Chromium binary is installed on this host.
//
// Stage 8 of the build skill calls this before the first render attempt.
// On `installed: false` the skill runs `playwright install chromium` and
// retries. On `installed: true` it short-circuits the install step.
//
// Implementation: Playwright's `chromium.executablePath()` returns the
// absolute path the runtime expects to find the binary at. We then stat
// that path to confirm it actually exists — `executablePath()` itself
// doesn't probe the filesystem.
//
// Resolution detail: `playwright` is a dep of `host-renderer/`, not
// `test-harness/`. We resolve it through host-renderer's package.json
// via `createRequire` rather than adding a duplicate dep here.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST_RENDERER_PKG = resolve(
  __dirname,
  "..",
  "..",
  "host-renderer",
  "package.json",
);

// Playwright resolves through createRequire from host-renderer/, which
// gives us an absolute path on disk. Node treats `await import(absolutePath)`
// against a CommonJS module as "wrap the exports under .default", so a
// naive `({ chromium } = await import(...))` returns undefined when
// playwright is shipped as CJS (the common case in the runtime tree).
// Read both shapes — ESM-native and CJS-wrapped — and return null if
// neither carries a `chromium` symbol. Note: this is a presence check
// only; we don't validate the surface (executablePath, launch, …).
// Validation happens at first call (`chromium.executablePath()` lower
// down), which fails clearly if a stub or wrong shape slipped through.
export function extractChromium(mod) {
  return mod?.chromium ?? mod?.default?.chromium ?? null;
}

export async function probeChromium() {
  let chromium;
  try {
    const requireFromHostRenderer = createRequire(HOST_RENDERER_PKG);
    const playwrightPath = requireFromHostRenderer.resolve("playwright");
    const mod = await import(playwrightPath);
    chromium = extractChromium(mod);
    if (!chromium) {
      return {
        installed: false,
        reason: "playwright import returned no chromium export",
      };
    }
  } catch (e) {
    return {
      installed: false,
      reason: `playwright import failed: ${e.message}`,
    };
  }

  let execPath;
  try {
    execPath = chromium.executablePath();
  } catch (e) {
    return {
      installed: false,
      reason: `chromium.executablePath() threw: ${e.message}`,
    };
  }

  if (!execPath || !existsSync(execPath)) {
    return { installed: false, executablePath: execPath ?? null };
  }

  return { installed: true, executablePath: execPath };
}

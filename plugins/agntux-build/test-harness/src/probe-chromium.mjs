// Probe whether a launchable headless Chromium is available on this host.
//
// The render gate calls this before the first render. On `installed: false`
// the caller installs `chromium-headless-shell` (the headless-only binary) and
// retries; on `installed: true` it renders.
//
// Implementation: a FUNCTIONAL probe — we actually launch headless Chromium,
// render a blank page, and close. This reports exactly what the render harness
// can do, so a `chromium-headless-shell`-only install is detected correctly.
// (The prior probe stat'd `chromium.executablePath()`, which points at the FULL
// chromium binary even when only the headless shell is installed — and a plain
// `chromium.launch({headless:true})` resolves to the shell — so that probe
// returned a false negative and made the gate skip a renderable plugin.)
//
// Resolution detail: `playwright` is a dep of `host-renderer/`, not
// `test-harness/`. We resolve it through host-renderer's package.json via
// `createRequire` rather than adding a duplicate dep here.

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

// Playwright resolves through createRequire from host-renderer/, which gives us
// an absolute path on disk. Node treats `await import(absolutePath)` against a
// CommonJS module as "wrap the exports under .default", so a naive
// `({ chromium } = await import(...))` returns undefined when playwright is
// shipped as CJS. Read both shapes — ESM-native and CJS-wrapped — and return
// null if neither carries a `chromium` symbol.
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

  // Functional probe: launch headless, render a blank page, close. A successful
  // launch is the ONLY thing that proves render will work, and it resolves to
  // the headless shell when that's what's installed.
  let browser = null;
  let mode = "default";
  let lastErr = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e1) {
    lastErr = e1;
    // One retry with --no-sandbox for hosts that reject the default sandbox.
    try {
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      mode = "no-sandbox";
      lastErr = null;
    } catch (e2) {
      lastErr = e2;
    }
  }
  if (!browser) {
    const msg = lastErr && lastErr.message ? lastErr.message : String(lastErr);
    return { installed: false, reason: `chromium.launch failed: ${msg}` };
  }

  try {
    const page = await browser.newPage();
    await page.setContent("<title>probe</title><h1>AGNTUXPROBE</h1>");
    const rendered = (await page.content()).includes("AGNTUXPROBE");
    await page.close();
    if (!rendered) {
      await browser.close();
      return { installed: false, reason: "headless render produced no content" };
    }
  } catch (e) {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    return { installed: false, reason: `headless page render failed: ${e.message}` };
  }

  // executablePath() is informational only — it reports the FULL chromium path
  // even when the headless shell was the binary that actually launched, so it is
  // NOT used for the installed decision.
  let executablePath = null;
  try {
    executablePath = chromium.executablePath();
  } catch {
    /* informational only */
  }
  await browser.close();
  return { installed: true, mode, executablePath };
}

// Headless Playwright driver. Loads the host page in a Chromium
// browser, waits for the inner UI iframe to settle, captures a
// screenshot + console errors + the structuredContent the tool
// returned, then closes the browser.
//
// Used by the `/__test/render` endpoint in `server.mjs`.

import { chromium } from "playwright";

const RENDER_SETTLE_MS = 1500;

export async function runHeadlessRender({
  hostBaseUrl,
  toolName,
  args,
  timeoutMs = 60_000,
}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 800, height: 700 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const consoleMessages = [];
  const consoleErrors = [];
  page.on("console", (msg) => {
    const entry = {
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
    };
    consoleMessages.push(entry);
    if (msg.type() === "error") consoleErrors.push(entry);
  });
  page.on("pageerror", (err) => {
    consoleErrors.push({ type: "pageerror", text: String(err) });
  });

  try {
    const url = `${hostBaseUrl}/host.html?tool=${encodeURIComponent(
      toolName,
    )}&args=${encodeURIComponent(JSON.stringify(args))}&autorun=1`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // Wait for the host page to signal "render complete" via a
    // window-level marker. The host-bridge sets `window.__agntuxRenderState`
    // to one of: "loading", "ui-ready", "tool-result", "error".
    await page.waitForFunction(
      () => {
        const s = window.__agntuxRenderState;
        return s === "tool-result" || s === "error";
      },
      { timeout: timeoutMs },
    );

    // Allow the inner iframe a moment to do any post-tool-result render
    // work (read user.md, populate the editor, etc).
    await page.waitForTimeout(RENDER_SETTLE_MS);

    const state = await page.evaluate(() => ({
      renderState: window.__agntuxRenderState,
      structuredContent: window.__agntuxStructuredContent ?? null,
      toolError: window.__agntuxToolError ?? null,
    }));

    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    const screenshotBase64 = screenshot.toString("base64");

    return {
      passed: state.renderState === "tool-result" && consoleErrors.length === 0,
      renderState: state.renderState,
      structuredContent: state.structuredContent,
      toolError: state.toolError,
      consoleErrors,
      consoleMessageCount: consoleMessages.length,
      screenshotBase64,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

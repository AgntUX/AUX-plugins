// Headless Playwright driver. Loads the host page in a Chromium
// browser, waits for the inner UI iframe to settle, captures a
// screenshot + console errors + the structuredContent the tool
// returned, then closes the browser.
//
// Used by the `/__test/render` endpoint in `server.mjs`.

import { chromium } from "playwright";

const RENDER_SETTLE_MS = 1500;

// ---------------------------------------------------------------------------
// Per-handler content expectations. Keys are the structuredContent fields
// expected to appear in the rendered iframe; values are how to find them.
//
// Each rule has:
//   - source:   "args" | "args.draft_body" | "args.draft_description" | etc.
//               Pulls the expected value from the test args.
//   - locator:  "body-text" | "textarea-value" | "button-text"
//               How to look for it in the iframe's DOM.
//   - optional: if true, missing the field doesn't fail the run.
// ---------------------------------------------------------------------------
const CONTENT_RULES = {
  jira_comment_view: [
    { source: "issue_key",   locator: "body-text" },
    { source: "draft_body",  locator: "textarea-value" },
    { verb: "Send",          locator: "button-text" },
  ],
  jira_transition_view: [
    { source: "issue_key",                  locator: "body-text" },
    { source: "optional_comment_draft",     locator: "textarea-value", optional: true },
    { verb: "Send",                         locator: "button-text" },
  ],
  jira_edit_view: [
    { source: "issue_key",   locator: "body-text" },
    { verb: "Send",          locator: "button-text" },
  ],
  jira_worklog_view: [
    { source: "issue_key",         locator: "body-text" },
    { source: "draft_duration",    locator: "input-or-body" },
    { verb: "Send",                locator: "button-text" },
  ],
  jira_create_view: [
    { source: "draft_title",       locator: "input-value", optional: true },
    { verb: "Create",              locator: "button-text" },
  ],
};

export async function runHeadlessRender({
  hostBaseUrl,
  toolName,
  args,
  argsExplicit = false,
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
    // argsExplicit=1 means a fixture / --args was applied upstream; the
    // host bridge uses this to suppress the empty-args hint when an
    // applied fixture happens to resolve to {} (the hint should only
    // fire when no source was applied at all).
    const url = `${hostBaseUrl}/host.html?tool=${encodeURIComponent(
      toolName,
    )}&args=${encodeURIComponent(JSON.stringify(args))}&argsExplicit=${
      argsExplicit ? "1" : "0"
    }&autorun=1`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    await page.waitForFunction(
      () => {
        const s = window.__agntuxRenderState;
        return s === "tool-result" || s === "error";
      },
      { timeout: timeoutMs },
    );

    await page.waitForTimeout(RENDER_SETTLE_MS);

    const state = await page.evaluate(() => ({
      renderState: window.__agntuxRenderState,
      structuredContent: window.__agntuxStructuredContent ?? null,
      toolError: window.__agntuxToolError ?? null,
      emptyArgsHint: window.__agntuxEmptyArgsHint ?? null,
    }));

    // --- CONTENT ASSERTIONS ---------------------------------------------
    // After the host page reaches "tool-result", drill into the inner
    // iframe (sandbox proxy → component iframe) and assert that the
    // expected fields actually rendered. A blank iframe must NOT pass.
    const contentChecks = await runContentChecks(page, toolName, args);

    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    const screenshotBase64 = screenshot.toString("base64");

    const passed =
      state.renderState === "tool-result" &&
      consoleErrors.length === 0 &&
      contentChecks.failed.length === 0;

    return {
      passed,
      renderState: state.renderState,
      structuredContent: state.structuredContent,
      toolError: state.toolError,
      emptyArgsHint: state.emptyArgsHint,
      consoleErrors,
      consoleMessageCount: consoleMessages.length,
      contentChecks,
      screenshotBase64,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// runContentChecks — drill into the inner iframe and verify each rule.
// ---------------------------------------------------------------------------
async function runContentChecks(page, toolName, args) {
  const rules = CONTENT_RULES[toolName] ?? [];
  if (rules.length === 0) {
    return { passed: [], failed: [], skipped: [{ reason: `no rules for ${toolName}` }] };
  }

  const result = { passed: [], failed: [], skipped: [] };

  // Resolve the inner iframe (component iframe inside sandbox-proxy iframe).
  // Wait up to 5s for it to attach.
  const innerFrame = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const outer = document.querySelector("iframe#ui");
          const sandbox = outer?.contentDocument;
          const inner = sandbox?.querySelector("iframe");
          if (inner && inner.contentDocument && inner.contentDocument.body && inner.contentDocument.body.innerText.length > 0) {
            resolve(true);
            return;
          }
          if (Date.now() - start > 5000) {
            resolve(false);
            return;
          }
          setTimeout(tick, 100);
        };
        tick();
      }),
  );

  if (!innerFrame) {
    result.failed.push({ reason: "inner iframe never rendered any text" });
    return result;
  }

  // For each rule, evaluate inside the inner frame.
  for (const rule of rules) {
    let expected;
    if (rule.source) {
      expected = args?.[rule.source];
    } else if (rule.verb) {
      expected = rule.verb;
    }

    if (expected == null || (typeof expected === "string" && expected.trim() === "")) {
      if (rule.optional) {
        result.skipped.push({ rule, reason: "expected value not provided" });
      } else if (!rule.verb) {
        result.skipped.push({ rule, reason: "expected value not provided" });
      } else {
        // verb rules always run
      }
      if (!rule.verb) continue;
    }

    const found = await page.evaluate(
      ({ locator, expected }) => {
        const outer = document.querySelector("iframe#ui");
        const sandbox = outer?.contentDocument;
        const inner = sandbox?.querySelector("iframe");
        const innerDoc = inner?.contentDocument;
        if (!innerDoc) return { ok: false, reason: "no inner doc" };
        const body = innerDoc.body;
        if (!body) return { ok: false, reason: "no inner body" };
        const exp = String(expected);
        if (locator === "body-text") {
          const text = body.innerText || body.textContent || "";
          return { ok: text.includes(exp), sample: text.slice(0, 200) };
        }
        if (locator === "textarea-value") {
          const tas = innerDoc.querySelectorAll("textarea");
          for (const t of tas) {
            if ((t.value || "").includes(exp)) return { ok: true };
          }
          return { ok: false, reason: `no <textarea> with value containing "${exp}"`, count: tas.length };
        }
        if (locator === "input-value") {
          const inputs = innerDoc.querySelectorAll("input");
          for (const i of inputs) {
            if ((i.value || "").includes(exp)) return { ok: true };
          }
          return { ok: false, reason: `no <input> with value containing "${exp}"`, count: inputs.length };
        }
        if (locator === "input-or-body") {
          const inputs = innerDoc.querySelectorAll("input");
          for (const i of inputs) {
            if ((i.value || "").includes(exp)) return { ok: true };
          }
          const text = body.innerText || body.textContent || "";
          if (text.includes(exp)) return { ok: true };
          return { ok: false, reason: `not in any <input> value or body text`, count: inputs.length };
        }
        if (locator === "button-text") {
          const btns = innerDoc.querySelectorAll("button");
          for (const b of btns) {
            const t = (b.innerText || b.textContent || "").trim();
            if (t.toLowerCase().includes(exp.toLowerCase())) return { ok: true };
          }
          return { ok: false, reason: `no <button> with text matching "${exp}"`, count: btns.length };
        }
        return { ok: false, reason: `unknown locator: ${locator}` };
      },
      { locator: rule.locator, expected },
    );

    if (found.ok) {
      result.passed.push({ rule, expected });
    } else {
      const entry = { rule, expected, ...found };
      if (rule.optional) {
        result.skipped.push(entry);
      } else {
        result.failed.push(entry);
      }
    }
  }

  return result;
}

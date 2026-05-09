// Client-side host bridge. Speaks the AppBridge postMessage protocol
// hand-rolled (no Zod, so strict-CSP hosts don't fail on eval). The
// fully-spec'd version lives in @modelcontextprotocol/ext-apps; we
// only implement the subset agntux-build's headless renderer needs:
//
//   1. Wait for sandbox-proxy-ready from the iframe
//   2. Send tool-call args + tool-result from the plugin's MCP
//   3. Capture structuredContent + display-mode requests onto window
//      globals so playwright-driver.mjs can read them
//
// Sets the following window globals (the headless driver waits on
// __agntuxRenderState):
//
//   window.__agntuxRenderState     "loading" | "ui-ready" | "tool-result" | "error"
//   window.__agntuxStructuredContent  the tool's structuredContent (object)
//   window.__agntuxToolError       error string when renderState === "error"

const params = new URLSearchParams(window.location.search);
const toolName = params.get("tool");
const argsRaw = params.get("args");
const autorun = params.get("autorun") === "1";
let toolArgs = {};
if (argsRaw) {
  try {
    toolArgs = JSON.parse(argsRaw);
  } catch {
    setError(`bad ?args= JSON: ${argsRaw}`);
  }
}

const HOST_CONTEXT = {
  theme: "light",
  platform: "web",
  displayMode: "inline",
  availableDisplayModes: ["inline", "fullscreen"],
  containerDimensions: { maxHeight: 600 },
  styles: {
    variables: {
      "--aux-bg": "#ffffff",
      "--aux-surface": "#f7f7f8",
      "--aux-fg": "#1a1a1a",
      "--aux-muted": "#6b6b73",
      "--aux-border": "#e5e5ea",
      "--aux-accent": "#1f6feb",
    },
  },
};

setRenderState("loading");

const statusEl = document.getElementById("status");
const diagEl = document.getElementById("diag");
function setStatus(text, isError = false) {
  if (statusEl) statusEl.textContent = text;
  if (diagEl && isError) {
    diagEl.classList.add("error");
    diagEl.textContent = text;
  }
}
function setRenderState(s) {
  window.__agntuxRenderState = s;
}
function setError(msg) {
  window.__agntuxToolError = String(msg);
  setRenderState("error");
  setStatus(msg, true);
}

if (!toolName) {
  setError("no ?tool= param");
} else if (autorun) {
  run().catch((e) => setError(e?.message ?? String(e)));
}

async function run() {
  setStatus(`calling ${toolName}…`);

  // 1. Call the tool through the in-process bridge endpoint.
  const callRes = await fetch("/api/tool-call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: toolName, args: toolArgs }),
  });
  if (!callRes.ok) {
    setError(`tool-call HTTP ${callRes.status}: ${await callRes.text()}`);
    return;
  }
  const { toolResult, uiResource } = await callRes.json();

  // 2. Stash structuredContent for the headless driver to read.
  window.__agntuxStructuredContent = toolResult?.structuredContent ?? null;

  if (!uiResource) {
    // tool has no UI handler — nothing to render, mark as result.
    setRenderState("tool-result");
    setStatus(`done (no UI handler)`);
    return;
  }

  // 3. Wire the iframe → load the sandbox proxy with the resource's CSP.
  const iframe = document.getElementById("ui");
  await loadSandbox(iframe, uiResource.csp);

  // 4. Once sandbox-proxy is ready, send the inner HTML.
  await sendResource(iframe, uiResource);

  // 5. Wait for the inner iframe (the actual UI handler component) to
  // signal it has wired its message listener. The MCP App spec uses
  // `ui/notifications/initialized` for this; AgntUX's hand-rolled
  // SimpleMcpApp posts the same. If the inner iframe doesn't speak the
  // protocol within INNER_INIT_TIMEOUT_MS, fall through anyway —
  // non-spec components just need their first message slightly later.
  setRenderState("ui-ready");
  await waitForInnerInitialized(iframe, 1500);

  // 6. Send hostContext + tool input + tool result to the inner app.
  const innerWindow = iframe.contentWindow;
  innerWindow.postMessage(
    { method: "ui/host/context", params: HOST_CONTEXT },
    "*",
  );
  innerWindow.postMessage(
    { method: "ui/tool-input", params: { arguments: toolArgs } },
    "*",
  );
  innerWindow.postMessage(
    { method: "ui/tool-result", params: toolResult },
    "*",
  );

  setRenderState("tool-result");
  setStatus(`rendered`);
}

function waitForInnerInitialized(iframe, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve();
    };
    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const m = event.data?.method;
      if (
        m === "ui/notifications/initialized" ||
        m === "initialize" ||
        m === "ui/sandbox/inner-ready"
      ) {
        finish();
      }
    };
    window.addEventListener("message", onMessage);
    setTimeout(finish, timeoutMs);
  });
}

async function loadSandbox(iframe, csp) {
  return new Promise((resolve) => {
    const onReady = (event) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.method !== "ui/notifications/sandbox-proxy-ready") return;
      window.removeEventListener("message", onReady);
      resolve();
    };
    window.addEventListener("message", onReady);
    const url = new URL("/sandbox.html", window.location.origin);
    if (csp) url.searchParams.set("csp", JSON.stringify(csp));
    iframe.src = url.toString();
  });
}

async function sendResource(iframe, uiResource) {
  iframe.contentWindow.postMessage(
    {
      method: "ui/sandbox/resource-ready",
      params: { html: uiResource.html, csp: uiResource.csp },
    },
    "*",
  );
  // Give the inner iframe ~one tick to receive + document.write the HTML.
  await new Promise((r) => setTimeout(r, 50));
}

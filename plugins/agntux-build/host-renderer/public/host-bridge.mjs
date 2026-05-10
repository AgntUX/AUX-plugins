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

  // 4a. Pre-attach the ui/initialize listener so we don't lose the inner
  //     iframe's request to a race.
  const initListener = attachInitListener();
  // 4b. Once sandbox-proxy is ready, send the inner HTML.
  await sendResource(iframe, uiResource);

  // 5. Wait for the inner iframe to send `ui/initialize` (the modern
  // JSON-RPC handshake from SimpleMcpApp), respond with hostContext,
  // then push tool-input + tool-result as JSON-RPC notifications.
  setRenderState("ui-ready");
  const innerWindow = iframe.contentWindow;
  // (initListener was attached earlier, before sendResource, to avoid a race
  //  where the inner iframe sends ui/initialize before we listen.)
  await handleInitializeAndPushResult(innerWindow, toolArgs, toolResult, initListener);

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

function attachInitListener() {
  // Listens for the ui/initialize JSON-RPC request from the inner iframe.
  // Returns a promise that resolves with the id (or null on 5s timeout).
  let resolveOuter;
  const promise = new Promise((r) => { resolveOuter = r; });
  let done = false;
  const finish = (initId) => {
    if (done) return;
    done = true;
    window.removeEventListener("message", onMessage);
    resolveOuter(initId);
  };
  const onMessage = (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.method === "ui/initialize" && data.id != null && data.jsonrpc === "2.0") {
      console.log("[host-bridge] caught ui/initialize id=", data.id);
      finish(data.id);
    }
  };
  window.addEventListener("message", onMessage);
  setTimeout(() => finish(null), 5000);
  return promise;
}

async function handleInitializeAndPushResult(innerWindow, toolArgs, toolResult, initPromise) {
  console.log("[host-bridge] waiting for ui/initialize");
  const seen = await initPromise;
  console.log("[host-bridge] init seen=", seen);

  if (seen != null) {
    innerWindow.postMessage(
      {
        jsonrpc: "2.0",
        id: seen,
        result: {
          protocolVersion: "0.5.0",
          hostInfo: { name: "agntux-build-host", version: "0.1.0" },
          hostContext: {
            ...HOST_CONTEXT,
            toolInfo: { tool: { name: toolName } },
          },
          hostCapabilities: {},
        },
      },
      "*",
    );
  }

  innerWindow.postMessage(
    {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { ...toolResult, _arguments: toolArgs },
    },
    "*",
  );
  innerWindow.postMessage(
    { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: toolResult },
    "*",
  );
  innerWindow.postMessage(
    { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: toolArgs } },
    "*",
  );
}

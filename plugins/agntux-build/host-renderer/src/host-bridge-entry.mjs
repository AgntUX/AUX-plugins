// Browser-side host bridge — bundled into public/host-bridge.mjs at install
// time by scripts/bundle-host-bridge.mjs. Loads in the host page Playwright
// drives and brokers the JSON-RPC handshake between the AgntUX MCP server
// (via Express endpoints) and the plugin's UI handler iframe.
//
// Architecture:
//
//   host page  <—— PostMessageTransport ——>  /sandbox.html (CSP boundary)
//                                                 ↑↓ relays
//                                          inner iframe (React, SimpleMcpApp)
//
// We use the canonical `AppBridge` + `PostMessageTransport` from
// `@modelcontextprotocol/ext-apps` rather than a hand-roll because:
//   1. Protocol drift is fatal here — even one mis-namespaced method name
//      stalls the inner React app forever (silent failure).
//   2. The "no Zod / no eval" rationale that justifies hand-rolling
//      `SimpleMcpApp` on the COMPONENT side does NOT apply here: this code
//      runs in a Playwright-driven Chromium with no CSP constraint, and
//      ext-apps@1.7.x ships in jitless Zod mode anyway.
//
// CRITICAL ORDERING (DO NOT REORDER):
//
//   1. Create + append the outer iframe element. iframe.contentWindow must
//      be non-null before we can construct the transport.
//   2. Construct PostMessageTransport(iframe.contentWindow, iframe.contentWindow).
//   3. Construct AppBridge, register oninitialized / onsandboxready handlers.
//   4. await bridge.connect(transport) — this calls transport.start(), which
//      attaches the window-level "message" listener.
//   5. ONLY THEN set iframe.src = "/sandbox.html?csp=...".
//
// If you swap steps 4 and 5, sandbox.html sends `ui/notifications/sandbox-
// proxy-ready` before our listener attaches, the bridge never sees it, and
// the rest of the protocol stalls. Same hazard as the canonical
// "connect-before-srcdoc" rule documented in
// `@modelcontextprotocol/ext-apps/dist/src/app-bridge.d.ts`.
//
// Globals this script writes for the Playwright driver to read:
//   window.__agntuxRenderState        "loading" | "ui-ready" | "tool-result" | "error"
//   window.__agntuxStructuredContent  the tool's structuredContent (object | null)
//   window.__agntuxToolError          error string when renderState === "error"
//   window.__agntuxBridge             the AppBridge instance (for click-through tests)
//   window.__agntuxCapturedMessages   array of `ui/message` request params from the view
//                                     (drives the C8 click-through assertion)

import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";

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

const HOST_INFO = { name: "agntux-build-host", version: "0.1.0" };
const HOST_CAPABILITIES = {
  openLinks: {},
  serverTools: {},
  logging: {},
};

window.__agntuxCapturedMessages = [];

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

  // 1. Pull the tool result + UI resource from the in-process MCP bridge.
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

  // Stash structuredContent for the headless driver to read.
  window.__agntuxStructuredContent = toolResult?.structuredContent ?? null;

  if (!uiResource) {
    // No UI handler — nothing to render.
    setRenderState("tool-result");
    setStatus(`done (no UI handler)`);
    return;
  }

  // 2. Resolve the iframe element in the DOM. host.html ships it pre-wired.
  const iframe = document.getElementById("ui");
  if (!iframe) {
    setError("missing #ui iframe element");
    return;
  }

  // 3. Construct the canonical AppBridge with no MCP client. We forward
  //    view-initiated tool calls through the same /api/tool-call endpoint,
  //    so we don't need automatic forwarding.
  const bridge = new AppBridge(null, HOST_INFO, HOST_CAPABILITIES, {
    hostContext: {
      ...HOST_CONTEXT,
      toolInfo: { tool: { name: toolName } },
    },
  });
  window.__agntuxBridge = bridge;

  // Forward view-initiated tool calls through the same Express endpoint.
  bridge.oncalltool = async (callParams) => {
    const fwd = await fetch("/api/tool-call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: callParams.name,
        args: callParams.arguments ?? {},
      }),
    });
    if (!fwd.ok) {
      return {
        content: [{ type: "text", text: `HTTP ${fwd.status}` }],
        isError: true,
      };
    }
    const { toolResult: out } = await fwd.json();
    return out;
  };

  // Capture view-initiated `ui/message` requests so the C8 click-through
  // assertion can verify the iframe emits the expected envelope when the
  // user clicks Send / Create.
  bridge.onmessage = async (msgParams) => {
    window.__agntuxCapturedMessages.push(msgParams);
    return {};
  };

  // Auto-OK any link the view tries to open (test environment).
  bridge.onopenlink = async () => ({});

  // 4. Sandbox-proxy lifecycle: when sandbox.html signals readiness, push
  //    the inner HTML in. The bridge handles the inner iframe's
  //    `ui/initialize` and follow-up notifications transparently.
  bridge.onsandboxready = () => {
    bridge
      .sendSandboxResourceReady({
        html: uiResource.html,
        sandbox: "allow-scripts allow-same-origin allow-forms",
      })
      .catch((err) => setError(`sendSandboxResourceReady: ${err?.message ?? err}`));
  };

  // When the inner React app finishes its initialize handshake, push the
  // tool input + result so it can render real data.
  bridge.oninitialized = () => {
    setRenderState("ui-ready");
    bridge
      .sendToolInput({ arguments: toolArgs })
      .then(() => bridge.sendToolResult(toolResult))
      .then(() => {
        setRenderState("tool-result");
        setStatus(`rendered`);
      })
      .catch((err) => setError(`tool-result push: ${err?.message ?? err}`));
  };

  // 5. Connect the transport BEFORE setting iframe.src. See the ordering
  //    note at the top of this file — flipping these two lines is the
  //    canonical way to break the protocol invisibly.
  const transport = new PostMessageTransport(
    iframe.contentWindow,
    iframe.contentWindow,
  );
  await bridge.connect(transport);

  // 6. NOW load the sandbox-proxy iframe.
  const sandboxUrl = new URL("/sandbox.html", window.location.origin);
  if (uiResource.csp) {
    sandboxUrl.searchParams.set("csp", JSON.stringify(uiResource.csp));
  }
  iframe.src = sandboxUrl.toString();
}

/**
 * share-file-ui.tsx — Dropbox Share File iframe entry.
 *
 * Mounts the Share form inside an AgntUX MCP Apps iframe. The handler
 * supplies: file_path, file_name, file_type, existing_link,
 * suggested_access, suggested_expiry, and source_context (read from the
 * action file). The user edits access level and optional expiry, then
 * clicks "Create link" to send the connector envelope.
 */

import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppsProvider,
  useAppsClient,
  useToolResult,
  useToolInput,
  useOnToolInputPartial,
  useHostContext,
  useWidgetState,
  useDisplayMode,
  useSafeAreaInsets,
  useDocumentTheme,
  useHostStyleVariables,
} from "./lib/apps-react/index.js";
import { ComponentErrorBoundary, ScrollablePanel, ServerErrorScreen, detectErrorEnvelope } from "@agntux/ui-primitives";
import { buildEnvelope } from "./apps/share/lib/build-envelope.js";
import { ExternalLink } from "./components/external-link.js";
import "./globals.css";

// ── Iframe height floor ───────────────────────────────────────────────────────
const VIEW_MIN_HEIGHT_PX = 480;
if (typeof document !== "undefined") {
  document.documentElement.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  if (document.body) {
    document.body.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  }
}

// ── Payload parsing ───────────────────────────────────────────────────────────

interface ShareData {
  action_id: string;
  source_context: string;
  file_path: string;
  file_name: string;
  file_type: string;
  existing_link: string;
  suggested_access: string;
  suggested_expiry: string;
}

function parsePayload(toolOutput?: Record<string, unknown>): ShareData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    action_id: s(payload.action_id),
    source_context: s(payload.source_context),
    file_path: s(payload.file_path),
    file_name: s(payload.file_name),
    file_type: s(payload.file_type),
    existing_link: s(payload.existing_link),
    suggested_access: s(payload.suggested_access) || "anyone",
    suggested_expiry: s(payload.suggested_expiry),
  };
}

// ── Streaming indicator ───────────────────────────────────────────────────────

function StreamingIndicator({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="sticky top-2 right-2 z-10 flex items-center justify-end px-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/80 backdrop-blur px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
        Generating...
      </div>
    </div>
  );
}

// ── Send state ────────────────────────────────────────────────────────────────

type SendState = "idle" | "sending" | "done" | "error";

// ── Share form component ──────────────────────────────────────────────────────

function ShareForm() {
  // ── ALL hooks FIRST — no early returns before this block ─────────────────
  useDocumentTheme("light", "dark");
  useHostStyleVariables();

  const client = useAppsClient();
  const toolResult = useToolResult();
  useToolInput(); // consumed for type completeness
  useHostContext();
  const [widgetState, setWidgetState] = useWidgetState<Record<string, unknown>>({});
  useDisplayMode();
  useSafeAreaInsets();

  const [partialInput, setPartialInput] = useState<Record<string, unknown> | undefined>(undefined);
  useOnToolInputPartial((input) => setPartialInput(input));

  // Controlled form state
  const [access, setAccess] = useState<string>("");
  const [expiry, setExpiry] = useState<string>("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // ── Derive tool output ────────────────────────────────────────────────────
  const toolOutput =
    toolResult && Object.keys(toolResult).length > 0
      ? (Object.values(toolResult)[0] as Record<string, unknown> | undefined)
      : undefined;

  const effectiveToolOutput =
    toolOutput ??
    (partialInput && Object.keys(partialInput).length > 0
      ? ({ _meta: { payload: partialInput } } as Record<string, unknown>)
      : undefined);

  const isStreaming = !toolOutput && !!partialInput;

  const data = useMemo(() => parsePayload(effectiveToolOutput), [effectiveToolOutput]);

  // ── Seed controlled fields from payload on first real render ──────────────
  const seeded = widgetState.__seeded as boolean | undefined;
  if (!seeded && data.file_path) {
    setAccess(data.suggested_access || "anyone");
    setExpiry(data.suggested_expiry || "");
    setWidgetState((prev) => ({ ...prev, __seeded: true }));
  }

  const effectiveAccess = access || data.suggested_access || "anyone";
  const effectiveExpiry = expiry !== "" ? expiry : data.suggested_expiry || "";

  // ── Now safe to branch on error envelope ─────────────────────────────────
  const errorEnvelope = detectErrorEnvelope(toolOutput);
  if (errorEnvelope) {
    return (
      <div className="h-full">
        <ServerErrorScreen message={errorEnvelope} />
      </div>
    );
  }

  const isLoading = !effectiveToolOutput && !data.file_name;

  const dropboxWebHref = data.file_path
    ? `https://www.dropbox.com/home${data.file_path}`
    : "https://www.dropbox.com";

  // ── Send handler ──────────────────────────────────────────────────────────
  async function handleSend() {
    if (!data.action_id || !data.file_path) return;
    setSendState("sending");
    setErrorMsg("");
    try {
      const envelope = buildEnvelope({
        file_path: data.file_path,
        file_name: data.file_name,
        access: effectiveAccess,
        expiry: effectiveExpiry,
        action_id: data.action_id,
      });
      await client.sendFollowUpMessage(envelope);
      setSendState("done");
    } catch {
      setSendState("error");
      setErrorMsg("Failed to send. Please try again.");
    }
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6" data-testid="loading-skeleton">
        <div className="mx-auto max-w-lg">
          <div className="mb-4 h-6 w-40 animate-pulse rounded-md bg-muted" />
          <div className="mb-6 h-4 w-56 animate-pulse rounded-md bg-muted" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Done state ─────────────────────────────────────────────────────────────
  if (sendState === "done") {
    return (
      <div className="flex h-full items-center justify-center bg-background p-8 text-center">
        <div>
          <p className="text-sm font-medium text-foreground">Link created</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The shared link for {data.file_name || "this file"} has been created.
          </p>
        </div>
      </div>
    );
  }

  // ── Title node with "Open in Dropbox" secondary link ──────────────────────
  const titleNode = (
    <span className="flex items-center justify-between w-full">
      <span className="font-semibold text-foreground">Share File</span>
      <ExternalLink
        href={dropboxWebHref}
        className="text-xs font-normal text-blue-600 hover:underline ml-2"
      >
        Open in Dropbox
      </ExternalLink>
    </span>
  );

  // ── Footer ────────────────────────────────────────────────────────────────
  const footer = (
    <div className="flex items-center justify-between gap-3">
      {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
      <div className="flex-1" />
      <button
        type="button"
        onClick={handleSend}
        disabled={isStreaming || sendState === "sending" || !data.file_path}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sendState === "sending" ? "Creating..." : "Create link"}
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-hidden bg-background">
      <StreamingIndicator visible={isStreaming} />
      <ScrollablePanel title={titleNode} footer={footer}>
        <fieldset disabled={isStreaming || sendState === "sending"} className="contents">
          <div className="space-y-5 p-4">
            {/* Source context */}
            {data.source_context && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                {data.source_context}
              </div>
            )}

            {/* File info */}
            <div className="rounded-md border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">File</p>
              <p className="text-sm font-medium text-foreground truncate">{data.file_name || "—"}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{data.file_path || "—"}</p>
              {data.file_type && (
                <p className="text-xs text-muted-foreground mt-0.5">Type: {data.file_type}</p>
              )}
            </div>

            {/* Existing link */}
            {data.existing_link && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Existing link</p>
                <ExternalLink
                  href={data.existing_link}
                  className="block truncate text-xs text-blue-600 hover:underline"
                >
                  {data.existing_link}
                </ExternalLink>
              </div>
            )}

            {/* Access level */}
            <div>
              <label htmlFor="share-access" className="block mb-1.5 text-xs font-medium text-foreground">
                Access level
              </label>
              <select
                id="share-access"
                value={effectiveAccess}
                onChange={(e) => setAccess(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="anyone">Anyone with the link</option>
                <option value="invited">Team members only</option>
              </select>
            </div>

            {/* Expiry date */}
            <div>
              <label htmlFor="share-expiry" className="block mb-1.5 text-xs font-medium text-foreground">
                Link expiry <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                id="share-expiry"
                type="date"
                value={effectiveExpiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </fieldset>
      </ScrollablePanel>
    </div>
  );
}

// ── Root mount ─────────────────────────────────────────────────────────────────

function App() {
  return (
    <ComponentErrorBoundary>
      <ShareForm />
    </ComponentErrorBoundary>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  rootElement.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  createRoot(rootElement).render(
    <StrictMode>
      <AppsProvider>
        <App />
      </AppsProvider>
    </StrictMode>,
  );
}

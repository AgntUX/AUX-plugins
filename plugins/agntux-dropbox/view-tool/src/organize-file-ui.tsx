/**
 * organize-file-ui.tsx — Dropbox Organize File iframe entry.
 *
 * Mounts the Organize form inside an AgntUX MCP Apps iframe. The handler
 * supplies: item_path, item_name, item_type, suggested_destination, mode,
 * and source_context (read from the action file). The user chooses Move or
 * Copy via tabs, edits the destination path, then clicks to commit.
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
import { buildEnvelope } from "./apps/organize/lib/build-envelope.js";
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

interface OrganizeData {
  action_id: string;
  source_context: string;
  item_path: string;
  item_name: string;
  item_type: string;
  suggested_destination: string;
  mode: string;
}

function parsePayload(toolOutput?: Record<string, unknown>): OrganizeData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    action_id: s(payload.action_id),
    source_context: s(payload.source_context),
    item_path: s(payload.item_path),
    item_name: s(payload.item_name),
    item_type: s(payload.item_type),
    suggested_destination: s(payload.suggested_destination),
    mode: s(payload.mode) || "move",
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

// ── Organize form component ───────────────────────────────────────────────────

function OrganizeForm() {
  // ── ALL hooks FIRST — no early returns before this block ─────────────────
  useDocumentTheme("light", "dark");
  useHostStyleVariables();

  const client = useAppsClient();
  const toolResult = useToolResult();
  useToolInput();
  useHostContext();
  const [widgetState, setWidgetState] = useWidgetState<Record<string, unknown>>({});
  useDisplayMode();
  useSafeAreaInsets();

  const [partialInput, setPartialInput] = useState<Record<string, unknown> | undefined>(undefined);
  useOnToolInputPartial((input) => setPartialInput(input));

  // Controlled form state
  const [mode, setMode] = useState<string>("");
  const [destination, setDestination] = useState<string>("");
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
  if (!seeded && data.item_path) {
    setMode(data.mode || "move");
    setDestination(data.suggested_destination || "");
    setWidgetState((prev) => ({ ...prev, __seeded: true }));
  }

  const effectiveMode = mode || data.mode || "move";
  const effectiveDestination = destination !== "" ? destination : data.suggested_destination || "";

  // ── Now safe to branch on error envelope ─────────────────────────────────
  const errorEnvelope = detectErrorEnvelope(toolOutput);
  if (errorEnvelope) {
    return (
      <div className="h-full">
        <ServerErrorScreen message={errorEnvelope} />
      </div>
    );
  }

  const isLoading = !effectiveToolOutput && !data.item_name;

  const dropboxWebHref = data.item_path
    ? `https://www.dropbox.com/home${data.item_path}`
    : "https://www.dropbox.com";

  // ── Send handler ──────────────────────────────────────────────────────────
  async function handleSend() {
    if (!data.action_id || !data.item_path || !effectiveDestination.trim()) return;
    setSendState("sending");
    setErrorMsg("");
    try {
      const envelope = buildEnvelope({
        item_path: data.item_path,
        item_name: data.item_name,
        item_type: data.item_type,
        destination_path: effectiveDestination.trim(),
        mode: effectiveMode,
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
    const verbPast = effectiveMode === "copy" ? "Copied" : "Moved";
    return (
      <div className="flex h-full items-center justify-center bg-background p-8 text-center">
        <div>
          <p className="text-sm font-medium text-foreground">{verbPast}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.item_name || "The item"} has been {verbPast.toLowerCase()} to{" "}
            {effectiveDestination || "the destination"}.
          </p>
        </div>
      </div>
    );
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  const titleNode = (
    <span className="flex items-center justify-between w-full">
      <span className="font-semibold text-foreground">Organize File</span>
      <ExternalLink
        href={dropboxWebHref}
        className="text-xs font-normal text-blue-600 hover:underline ml-2"
      >
        Open in Dropbox
      </ExternalLink>
    </span>
  );

  // ── Footer ─────────────────────────────────────────────────────────────────
  const commitLabel =
    effectiveMode === "copy"
      ? sendState === "sending" ? "Copying..." : "Copy here"
      : sendState === "sending" ? "Moving..." : "Move here";

  const footer = (
    <div className="flex items-center justify-between gap-3">
      {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
      <div className="flex-1" />
      <button
        type="button"
        onClick={handleSend}
        disabled={
          isStreaming ||
          sendState === "sending" ||
          !data.item_path ||
          !effectiveDestination.trim()
        }
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {commitLabel}
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

            {/* Item info */}
            <div className="rounded-md border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                {data.item_type === "folder" ? "Folder" : "File"}
              </p>
              <p className="text-sm font-medium text-foreground truncate">{data.item_name || "—"}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{data.item_path || "—"}</p>
            </div>

            {/* Mode tabs */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground">Action</p>
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMode("move")}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    effectiveMode === "move"
                      ? "bg-blue-600 text-white"
                      : "bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  Move
                </button>
                <button
                  type="button"
                  onClick={() => setMode("copy")}
                  className={`flex-1 py-2 text-sm font-medium transition-colors border-l border-border ${
                    effectiveMode === "copy"
                      ? "bg-blue-600 text-white"
                      : "bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  Copy
                </button>
              </div>
              {effectiveMode === "move" ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  The item will be moved — removed from its current location.
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  A copy will be placed at the destination; the original stays.
                </p>
              )}
            </div>

            {/* Destination path */}
            <div>
              <label
                htmlFor="organize-destination"
                className="block mb-1.5 text-xs font-medium text-foreground"
              >
                Destination path
              </label>
              <input
                id="organize-destination"
                type="text"
                value={effectiveDestination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="/Your Folder/Subfolder/filename.ext"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Full Dropbox path including the item name at its destination.
              </p>
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
      <OrganizeForm />
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

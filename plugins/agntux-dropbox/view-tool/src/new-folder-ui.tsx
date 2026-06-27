/**
 * new-folder-ui.tsx — Dropbox New Folder iframe entry.
 *
 * Mounts the New Folder form inside an AgntUX MCP Apps iframe. The handler
 * supplies: parent_path, parent_name, suggested_folder_name, and
 * source_context (read from the action file). The user confirms or edits
 * the folder name, then clicks "Create folder".
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
import { buildEnvelope } from "./apps/new-folder/lib/build-envelope.js";
import { ExternalLink } from "./components/external-link.js";
import "./globals.css";

// ── Iframe height floor ───────────────────────────────────────────────────────
const VIEW_MIN_HEIGHT_PX = 420;
if (typeof document !== "undefined") {
  document.documentElement.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  if (document.body) {
    document.body.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  }
}

// ── Payload parsing ───────────────────────────────────────────────────────────

interface NewFolderData {
  action_id: string;
  source_context: string;
  parent_path: string;
  parent_name: string;
  suggested_folder_name: string;
}

function parsePayload(toolOutput?: Record<string, unknown>): NewFolderData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    action_id: s(payload.action_id),
    source_context: s(payload.source_context),
    parent_path: s(payload.parent_path),
    parent_name: s(payload.parent_name),
    suggested_folder_name: s(payload.suggested_folder_name),
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

// ── New folder form component ─────────────────────────────────────────────────

function NewFolderFormComponent() {
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
  const [folderName, setFolderName] = useState<string>("");
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
  if (!seeded && data.parent_path) {
    setFolderName(data.suggested_folder_name || "");
    setWidgetState((prev) => ({ ...prev, __seeded: true }));
  }

  const effectiveFolderName = folderName !== "" ? folderName : data.suggested_folder_name || "";

  // ── Now safe to branch on error envelope ─────────────────────────────────
  const errorEnvelope = detectErrorEnvelope(toolOutput);
  if (errorEnvelope) {
    return (
      <div className="h-full">
        <ServerErrorScreen message={errorEnvelope} />
      </div>
    );
  }

  const isLoading = !effectiveToolOutput && !data.parent_path;

  const dropboxWebHref = data.parent_path
    ? `https://www.dropbox.com/home${data.parent_path}`
    : "https://www.dropbox.com";

  // ── Send handler ──────────────────────────────────────────────────────────
  async function handleSend() {
    if (!data.action_id || !data.parent_path || !effectiveFolderName.trim()) return;
    setSendState("sending");
    setErrorMsg("");
    try {
      const envelope = buildEnvelope({
        parent_path: data.parent_path,
        parent_name: data.parent_name,
        folder_name: effectiveFolderName.trim(),
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
            {[1, 2].map((i) => (
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
          <p className="text-sm font-medium text-foreground">Folder created</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {effectiveFolderName} has been created inside{" "}
            {data.parent_name || data.parent_path || "the parent folder"}.
          </p>
        </div>
      </div>
    );
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  const titleNode = (
    <span className="flex items-center justify-between w-full">
      <span className="font-semibold text-foreground">New Folder</span>
      <ExternalLink
        href={dropboxWebHref}
        className="text-xs font-normal text-blue-600 hover:underline ml-2"
      >
        Open in Dropbox
      </ExternalLink>
    </span>
  );

  // ── Footer ─────────────────────────────────────────────────────────────────
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
          !data.parent_path ||
          !effectiveFolderName.trim()
        }
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sendState === "sending" ? "Creating..." : "Create folder"}
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

            {/* Parent folder info */}
            <div className="rounded-md border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Parent folder
              </p>
              <p className="text-sm font-medium text-foreground truncate">
                {data.parent_name || data.parent_path || "—"}
              </p>
              {data.parent_name && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{data.parent_path}</p>
              )}
            </div>

            {/* Folder name */}
            <div>
              <label
                htmlFor="new-folder-name"
                className="block mb-1.5 text-xs font-medium text-foreground"
              >
                New folder name
              </label>
              <input
                id="new-folder-name"
                type="text"
                value={effectiveFolderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="My New Folder"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {data.parent_path && effectiveFolderName.trim() && (
                <p className="mt-1 text-xs text-muted-foreground truncate">
                  Will be created at:{" "}
                  {data.parent_path.endsWith("/") ? data.parent_path : `${data.parent_path}/`}
                  {effectiveFolderName.trim()}
                </p>
              )}
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
      <NewFolderFormComponent />
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

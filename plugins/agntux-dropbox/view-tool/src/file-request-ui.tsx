/**
 * file-request-ui.tsx — Dropbox File Request iframe entry.
 *
 * Mounts the File Request form inside an AgntUX MCP Apps iframe. The handler
 * supplies: destination_path, destination_name, suggested_title,
 * suggested_deadline, and source_context (read from the action file). The
 * user confirms or edits the title and optional deadline, then clicks
 * "Send request" to create the Dropbox file request link.
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
import { buildEnvelope } from "./apps/file-request/lib/build-envelope.js";
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

interface FileRequestData {
  action_id: string;
  source_context: string;
  destination_path: string;
  destination_name: string;
  suggested_title: string;
  suggested_deadline: string;
}

function parsePayload(toolOutput?: Record<string, unknown>): FileRequestData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    action_id: s(payload.action_id),
    source_context: s(payload.source_context),
    destination_path: s(payload.destination_path),
    destination_name: s(payload.destination_name),
    suggested_title: s(payload.suggested_title),
    suggested_deadline: s(payload.suggested_deadline),
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

// ── File request form component ───────────────────────────────────────────────

function FileRequestFormComponent() {
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
  const [title, setTitle] = useState<string>("");
  const [deadline, setDeadline] = useState<string>("");
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
  if (!seeded && data.destination_path) {
    setTitle(data.suggested_title || "");
    setDeadline(data.suggested_deadline || "");
    setWidgetState((prev) => ({ ...prev, __seeded: true }));
  }

  const effectiveTitle = title !== "" ? title : data.suggested_title || "";
  const effectiveDeadline = deadline !== "" ? deadline : data.suggested_deadline || "";

  // ── Now safe to branch on error envelope ─────────────────────────────────
  const errorEnvelope = detectErrorEnvelope(toolOutput);
  if (errorEnvelope) {
    return (
      <div className="h-full">
        <ServerErrorScreen message={errorEnvelope} />
      </div>
    );
  }

  const isLoading = !effectiveToolOutput && !data.destination_path;

  const dropboxWebHref = data.destination_path
    ? `https://www.dropbox.com/home${data.destination_path}`
    : "https://www.dropbox.com";

  // ── Send handler ──────────────────────────────────────────────────────────
  async function handleSend() {
    if (!data.action_id || !data.destination_path || !effectiveTitle.trim()) return;
    setSendState("sending");
    setErrorMsg("");
    try {
      const envelope = buildEnvelope({
        destination_path: data.destination_path,
        destination_name: data.destination_name,
        title: effectiveTitle.trim(),
        deadline: effectiveDeadline,
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
          <p className="text-sm font-medium text-foreground">Request created</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The file request "{effectiveTitle}" has been created. Dropbox will
            provide a link people can use to upload files.
          </p>
        </div>
      </div>
    );
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  const titleNode = (
    <span className="flex items-center justify-between w-full">
      <span className="font-semibold text-foreground">File Request</span>
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
          !data.destination_path ||
          !effectiveTitle.trim()
        }
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sendState === "sending" ? "Sending..." : "Send request"}
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

            {/* Destination folder info */}
            <div className="rounded-md border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Upload destination
              </p>
              <p className="text-sm font-medium text-foreground truncate">
                {data.destination_name || data.destination_path || "—"}
              </p>
              {data.destination_name && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {data.destination_path}
                </p>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                Uploaded files will land in this Dropbox folder.
              </p>
            </div>

            {/* Request title */}
            <div>
              <label
                htmlFor="file-request-title"
                className="block mb-1.5 text-xs font-medium text-foreground"
              >
                Request title
              </label>
              <input
                id="file-request-title"
                type="text"
                value={effectiveTitle}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Please send me your files"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                This is what recipients see when they open the upload link.
              </p>
            </div>

            {/* Deadline */}
            <div>
              <label
                htmlFor="file-request-deadline"
                className="block mb-1.5 text-xs font-medium text-foreground"
              >
                Deadline{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                id="file-request-deadline"
                type="date"
                value={effectiveDeadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                After this date the upload link will stop accepting new files.
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
      <FileRequestFormComponent />
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

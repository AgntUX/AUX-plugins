// =============================================================================
// main-component.tsx — canvas card main component.
// =============================================================================

import { ScrollablePanel } from "./scrollable-panel.js";
import { CanvasCard } from "./canvas-card.js";
import { Spinner } from "./spinner.js";
import { AgntuxLogo } from "./agntux-logo.js";
import { normalizeCanvasPayload } from "../lib/normalize.js";

export interface MainComponentProps {
  toolOutput: Record<string, unknown> | undefined;
  toolInput: Record<string, unknown> | undefined;
  isStreaming?: boolean;
  widgetState: Record<string, unknown>;
  setWidgetState: (
    next:
      | Record<string, unknown>
      | ((prev: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage: (prompt: string) => Promise<void>;
  displayMode: string;
  availableDisplayModes: string[];
  requestDisplayMode: (mode: 'inline' | 'fullscreen' | 'pip') => Promise<void>;
  theme: string;
  locale: string;
  safeArea: { top: number; right: number; bottom: number; left: number };
  viewport: { width: number; height: number };
  platform: string;
}

export function parsePayload(toolOutput: Record<string, unknown> | undefined) {
  if (!toolOutput) return null;
  return normalizeCanvasPayload(toolOutput);
}

export function MainComponent({ toolOutput, isStreaming }: MainComponentProps) {
  if (!toolOutput && !isStreaming) {
    return (
      <div
        data-testid="loading-skeleton"
        className="flex h-full items-center justify-center p-6"
        aria-label="Loading canvas card"
      >
        <Spinner size={6} label="Loading canvas card" />
      </div>
    );
  }

  if (!toolOutput && isStreaming) {
    return (
      <div
        data-testid="streaming-skeleton"
        className="flex h-full items-center justify-center p-6"
        aria-label="Preparing canvas"
      >
        <Spinner size={6} label="Preparing canvas" />
      </div>
    );
  }

  const data = parsePayload(toolOutput);

  if (!data) {
    return (
      <div data-testid="loading-skeleton" className="flex h-full items-center justify-center p-6">
        <Spinner size={6} label="Loading" />
      </div>
    );
  }

  if (data.error) {
    return <ErrorState error={data.error} />;
  }

  return (
    <ScrollablePanel
      title={
        <span
          className="flex items-center gap-2"
          data-testid="canvas-header"
        >
          <AgntuxLogo height={18} />
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span data-testid="canvas-header-title">Slack Canvas</span>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            #{data.channel.name}
          </span>
        </span>
      }
    >
      <CanvasCard payload={data} />
    </ScrollablePanel>
  );
}

const ERROR_COPY: Record<string, { title: string; body: string; testId: string }> = {
  action_not_found: {
    title: "Action not found",
    body: "Couldn't find that action item — it may have been resolved or removed.",
    testId: "error-action-not-found",
  },
  action_already_handled: {
    title: "Already handled",
    body: "This action is no longer open — already done, dismissed, or snoozed.",
    testId: "error-action-already-handled",
  },
  agntux_root_missing: {
    title: "AgntUX not set up",
    body: "Run /agntux-onboard to set up your AgntUX workspace.",
    testId: "error-agntux-root-missing",
  },
  canvas_payload_missing: {
    title: "Canvas summary not available",
    body: "This action was created before pre-composed canvases shipped, or wasn't flagged as canvas-worthy. Open it in Slack to summarise the thread there.",
    testId: "error-canvas-payload-missing",
  },
};

function ErrorState({ error }: { error: string }) {
  const copy = ERROR_COPY[error] ?? {
    title: "Something went wrong",
    body: `An unexpected error occurred (${error}).`,
    testId: "error-unknown",
  };
  return (
    <div data-testid={copy.testId} role="alert" className="flex flex-col gap-2 p-4">
      <div className="text-sm font-semibold text-foreground">{copy.title}</div>
      <p className="text-xs text-muted-foreground">{copy.body}</p>
    </div>
  );
}

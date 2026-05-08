// =============================================================================
// main-component.tsx — gmail compose card main component.
//
// Coding agents: edit this file for compose-specific UI. Edit App.tsx only for
// protocol-level additions (new host notifications, new hooks).
// =============================================================================

import { AgntuxLogo, ScrollablePanel, Spinner } from "@agntux/ui-primitives";
import { ComposeCard } from "./compose-card.js";
import { normalizeComposePayload } from "../lib/normalize.js";

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

/**
 * parsePayload — exported for unit tests. Accepts any toolOutput shape and
 * returns a normalized compose payload or error. Never throws.
 */
export function parsePayload(
  toolOutput: Record<string, unknown> | undefined,
) {
  if (!toolOutput) return null;
  return normalizeComposePayload(toolOutput);
}

export function MainComponent({ toolOutput, isStreaming }: MainComponentProps) {
  if (isStreaming) {
    return (
      <div
        data-testid="streaming-skeleton"
        className="flex h-full items-center justify-center p-6"
        aria-label="Preparing draft"
      >
        <Spinner size={6} label="Preparing draft" />
      </div>
    );
  }

  if (!toolOutput) {
    return (
      <div
        data-testid="loading-skeleton"
        className="flex h-full items-center justify-center p-6"
        aria-label="Loading compose card"
      >
        <Spinner size={6} label="Loading compose card" />
      </div>
    );
  }

  const data = parsePayload(toolOutput);

  if (!data) {
    return (
      <div
        data-testid="loading-skeleton"
        className="flex h-full items-center justify-center p-6"
      >
        <Spinner size={6} label="Loading" />
      </div>
    );
  }

  if (data.error) {
    return (
      <ErrorState error={data.error} />
    );
  }

  const subjectShort = data.thread.subject.length > 60
    ? data.thread.subject.slice(0, 57) + "…"
    : data.thread.subject;

  return (
    <ScrollablePanel
      title={
        <span
          className="flex items-center gap-2"
          data-testid="compose-header"
        >
          <AgntuxLogo height={18} />
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span data-testid="compose-title">Gmail Compose</span>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="text-xs font-normal text-muted-foreground truncate max-w-[24rem]">
            {subjectShort || "(no subject)"}
          </span>
        </span>
      }
    >
      <ComposeCard payload={data} />
    </ScrollablePanel>
  );
}

// ── Error states ─────────────────────────────────────────────────────────────

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
    body: "Run /agntux onboard to set up your AgntUX workspace.",
    testId: "error-agntux-root-missing",
  },
  compose_payload_missing: {
    title: "Draft not available",
    body: "This action has no pre-composed draft. Open it in Gmail to reply there.",
    testId: "error-compose-payload-missing",
  },
};

function ErrorState({ error }: { error: string }) {
  const copy = ERROR_COPY[error] ?? {
    title: "Something went wrong",
    body: `An unexpected error occurred (${error}).`,
    testId: "error-unknown",
  };

  return (
    <div
      data-testid={copy.testId}
      role="alert"
      className="flex flex-col gap-2 p-4"
    >
      <div className="text-sm font-semibold text-foreground">{copy.title}</div>
      <p className="text-xs text-muted-foreground">{copy.body}</p>
    </div>
  );
}

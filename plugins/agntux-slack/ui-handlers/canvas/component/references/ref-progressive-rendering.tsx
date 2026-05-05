/**
 * ref-progressive-rendering.tsx
 *
 * Canonical progressive-rendering + defensive-parsing patterns.
 *
 * The host emits three UI notifications for each tool call, in order:
 *
 *   1. ui/notifications/tool-input-partial  — fires 0..N times as the model
 *      generates tool args. Each notification carries the FULL current args
 *      object (NOT a delta). The host auto-closes unclosed JSON structures,
 *      so every partial parses; but fields are frequently absent, arrays
 *      empty, nested objects null, and keys occasionally mid-transition
 *      between snake_case and camelCase.
 *
 *   2. ui/notifications/tool-input          — fires once when args are final.
 *
 *   3. ui/notifications/tool-result         — fires once when the server
 *      handler completes. `useToolResult()` populates here. This is the
 *      "streaming complete, UI safe to accept user input" signal.
 *
 * App.tsx subscribes to `tool-input-partial` via `useOnToolInputPartial`
 * and synthesizes a `toolOutput` envelope (`{ _meta: { payload } }`) from
 * each partial, so your `parsePayload()` handles streaming and final renders
 * uniformly. `isStreaming=true` means `!toolOutput && !!partialInput`.
 *
 * Two invariants your component MUST uphold:
 *
 *   A. DEFENSIVE PARSING. Every field read from `toolOutput` defaults to a
 *      safe value. Arrays → [], objects → {}, strings → '', numbers → 0,
 *      booleans → false. No field may be allowed to reach JSX as `undefined`
 *      where `.map` / `.length` / `.toUpperCase` would be called on it.
 *
 *   B. READ-ONLY WHILE STREAMING. Partials re-fire many times per second.
 *      Any `<input value={data.x}>` whose value ties to `data.*` would be
 *      wiped on every re-render. Any mutating click during streaming would
 *      send `sendFollowUpMessage` against a half-complete payload. Wrap the
 *      interactive region in `<fieldset disabled={isStreaming}>` so every
 *      descendant `<button>`, `<input>`, `<textarea>`, `<select>` goes
 *      read-only automatically. The fieldset re-enables the instant the
 *      real `tool-result` arrives.
 *
 * The streaming indicator is required but NON-INVASIVE: a small pulsing-dot
 * chip sticky-positioned in the top-right, `role="status"`, `aria-live="polite"`.
 * It does NOT block content, does NOT overlay, does NOT reflow layout.
 */

import { useMemo } from 'react';

// -----------------------------------------------------------------------------
// The view-model produced by parsePayload.
//
// Shape this to match your tool's outputStructure + _meta spec. Every field
// has a typed default so callers can safely `.map`, `.length`, etc. without
// checks.
// -----------------------------------------------------------------------------

interface ViewModel {
  title: string;
  summary: string;
  status: 'idle' | 'active' | 'error';
  items: ReadonlyArray<{
    id: string;
    name: string;
    channelName: string;
    dueAt: string | undefined;
  }>;
  integrations: { todoAvailable: boolean };
  updatedAt: string | undefined;
}

// -----------------------------------------------------------------------------
// parsePayload — THE defensive helper. Every component has one.
//
// Handles three envelope shapes uniformly:
//   A) { _meta: { payload: {...} } }   — canonical relay envelope; also the
//                                        synthesized shape during streaming.
//   B) {...}                           — flat structuredContent.
//   C) {} / undefined                  — pre-first-partial or empty.
//
// Key-transition tolerance: early partials may briefly emit snake_case
// variants (`channel_name` before `channelName`). Prefer naming inputSchema
// fields identically to outputStructure fields so no transition is needed.
// If unavoidable, accept either spelling (see `channelName` below).
// -----------------------------------------------------------------------------

export function parsePayload(toolOutput?: Record<string, unknown>): ViewModel {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<
    string,
    unknown
  >;

  const rawItems = Array.isArray(payload.items)
    ? (payload.items as unknown[])
    : [];

  const integrations = (payload.integrations ?? {}) as Record<string, unknown>;

  return {
    title: typeof payload.title === 'string' ? payload.title : '',
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    status:
      payload.status === 'active' || payload.status === 'error'
        ? payload.status
        : 'idle',
    items: rawItems.map((raw, index) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      // Accept either snake_case or camelCase during the partial stream.
      const channel = (item.channel ?? {}) as Record<string, unknown>;
      const channelName =
        (typeof item.channelName === 'string' && item.channelName) ||
        (typeof item.channel_name === 'string' && item.channel_name) ||
        (typeof channel.name === 'string' && channel.name) ||
        '';
      return {
        id: typeof item.id === 'string' ? item.id : `__partial_${index}`,
        name: typeof item.name === 'string' ? item.name : '',
        channelName,
        dueAt: typeof item.dueAt === 'string' ? item.dueAt : undefined,
      };
    }),
    integrations: {
      todoAvailable:
        typeof integrations.todoAvailable === 'boolean'
          ? integrations.todoAvailable
          : false,
    },
    updatedAt:
      typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
  };
}

// -----------------------------------------------------------------------------
// The canonical component. Reads `toolOutput` + `isStreaming`, renders a
// skeleton while there's nothing renderable, and switches to the real UI
// the moment the first partial has data — keeping controls disabled until
// the real tool-result lands.
// -----------------------------------------------------------------------------

interface Props {
  toolOutput?: Record<string, unknown> | undefined;
  isStreaming?: boolean;
  sendFollowUpMessage: (prompt: string) => Promise<void>;
}

export function ProgressiveExample(props: Props) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Skeleton gates on hasAnyRenderableData — NOT on `!toolOutput`. The
  // first partial with any array entry or title field clears it.
  const hasAnyRenderableData = data.items.length > 0 || !!data.title;
  const isLoading = !toolOutput && !hasAnyRenderableData;

  if (isLoading) {
    return (
      <div
        className="h-full overflow-y-auto bg-background p-6"
        data-testid="loading-skeleton"
      >
        <div className="mb-3 h-6 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  const handleAcknowledge = async (itemId: string) => {
    // Belt-and-suspenders guard: the enclosing fieldset already disables the
    // button, but for click handlers on non-button elements (div/span cards)
    // this early-return is the equivalent.
    if (isStreaming) return;
    await sendFollowUpMessage(`Acknowledge item ${itemId}.`);
  };

  return (
    <div
      className="h-full overflow-y-auto bg-background"
      aria-busy={isStreaming ? 'true' : 'false'}
    >
      <StreamingIndicator visible={!!isStreaming} />
      {/* `className="contents"` makes fieldset lay out as if it weren't there. */}
      <fieldset disabled={isStreaming} className="contents">
        <div className="p-4 space-y-3">
          {data.title && (
            <h2 className="text-base font-semibold text-foreground">
              {data.title}
            </h2>
          )}

          {/* Sections render behind `{data.X.length > 0 && (...)}` — never
              "No items yet" empty-state copy while streaming, it flickers. */}
          {data.items.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {data.items.map((item) => (
                // Stable keys with a fallback — `item.id` might briefly be a
                // synthesized `__partial_N` during the stream.
                <li key={item.id} className="flex items-center gap-3 p-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-card-foreground">
                      {item.name || 'Untitled'}
                    </p>
                    {/* Guard string interpolations: `{x && ` by ${x}`}` never
                        `by ${x}` — the latter renders "by undefined". */}
                    {item.channelName && (
                      <p className="text-xs text-muted-foreground">
                        in #{item.channelName}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleAcknowledge(item.id);
                    }}
                    className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Acknowledge
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>
    </div>
  );
}

// -----------------------------------------------------------------------------
// StreamingIndicator — non-invasive status chip.
//
// - Sticky-positioned top-right so it doesn't reflow content.
// - `role="status"` + `aria-live="polite"` for screen readers.
// - `pointer-events-none` so it can never intercept clicks.
// - Disappears the frame after `toolOutput` becomes defined.
// - Text uses `useTranslation()` in real components: t('streaming.generating').
// -----------------------------------------------------------------------------

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
        Generating…
      </div>
    </div>
  );
}

// =============================================================================
// ANTI-PATTERNS — DO NOT DO THESE
// =============================================================================

/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * ❌ BAD: reading from toolOutput inline without parsePayload.
 *
 * `toolOutput?.items.map(...)` throws "Cannot read properties of undefined"
 * the moment a partial arrives with `items: null` (common during streaming).
 */
function BadInlineAccess({
  toolOutput,
}: {
  toolOutput?: Record<string, unknown>;
}) {
  // @ts-expect-error — demonstrating the runtime failure mode
  return (
    <ul>
      {toolOutput?.items.map((x: { name: string }) => (
        <li>{x.name}</li>
      ))}
    </ul>
  );
}

/**
 * ❌ BAD: `<input value={data.x}>` outside a disabled fieldset.
 *
 * Every partial re-render wipes user input. The user types "hello", the next
 * partial (arriving ~100ms later) resets the field to whatever the streaming
 * payload says, and the user's text is gone.
 */
function BadUnguardedInput({
  data,
  onChange,
}: {
  data: { title: string };
  onChange: (v: string) => void;
}) {
  return (
    <input
      value={data.title}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-input px-2 py-1"
    />
  );
}

/**
 * ❌ BAD: zero-state copy during streaming.
 *
 * Renders "No items yet" between partials, then flickers to the list as
 * soon as an `items: [...]` partial arrives. Jarring. Prefer
 * `{data.items.length > 0 && (<list/>)}` and omit the empty-state branch
 * entirely while `isStreaming`.
 */
function BadEmptyStateDuringStream({
  data,
  isStreaming,
}: {
  data: { items: unknown[] };
  isStreaming: boolean;
}) {
  if (data.items.length === 0) return <p>No items yet</p>;
  return <ul>{/* ... */}</ul>;
}

/**
 * ❌ BAD: `new Date()` or other non-deterministic values during streaming.
 *
 * Host-authored single-writer rule: the component never synthesizes
 * timestamps, ids, or UUIDs. If the server didn't send it, it doesn't exist.
 */
function BadClientSideTimestamp() {
  return <p>Updated at {new Date().toISOString()}</p>;
}

/* eslint-enable @typescript-eslint/no-unused-vars */

// =============================================================================
// SELF-REVIEW GREP TABLE
//
// Run these in `src/components/**/*.tsx` before declaring work complete.
// =============================================================================
//
// | Pattern                                             | Expected           | Why                                            |
// | --------------------------------------------------- | ------------------ | ---------------------------------------------- |
// | `\.map\(`                                           | all preceded by `?? []` or `Array.isArray(` | `.map` on undefined throws          |
// | inline `toolOutput\?\.` chained without `??`        | 0                  | Defensive parse happens once in `parsePayload` |
// | `new Date\(\)\.toISOString`                         | 0                  | Host-authored timestamps only                  |
// | `onClick=\{\(\) => \{\}\}`                          | 0                  | No dead handlers                               |
// | function `parsePayload` / `parseToolOutput`         | ≥1                 | Defensive helper is mandatory                  |
// | `useOnToolInputPartial` in `App.tsx`                | 1                  | Progressive rendering is default, not opt-in   |
// | `<fieldset disabled=\{isStreaming`                  | ≥1                 | Read-only during streaming                     |
// | `<input value=\{data\.`                             | 0 outside fieldset | Streaming-bound inputs must be disabled        |

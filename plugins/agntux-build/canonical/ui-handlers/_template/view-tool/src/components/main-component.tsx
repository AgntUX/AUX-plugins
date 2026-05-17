import { useMemo } from 'react';

// Inline viewport budget: this component MUST remain usable at 600px tall.
// - Do NOT use min-h-screen / h-screen / 100vh / 100dvh anywhere.
// - Root container owns its own vertical scroll (h-full overflow-y-auto).
// - Forms and tables scroll their body internally; primary actions stick.
// - For overflow patterns, read `references/ref-scrollable-panel.tsx`.
// - For the canonical layout primitive, import `ScrollablePanel` from
//   `@agntux/ui-primitives` (sticky header + scrolling body + sticky footer).
//   Modals are forbidden in inline iframes — see
//   `canonical/prompts/ui/briefing-learnings.md` §2.4 for the retirement
//   record. The same `ScrollablePanel` primitive serves as the top-level
//   layout for single-view handlers AND as the row-anchored expansion panel
//   for list-view handlers.
//
// Progressive rendering + defensive parsing (CRITICAL):
// - `isStreaming=true` means the host is still emitting `tool-input-partial`
//   notifications and the real tool-result has not arrived yet.
// - `toolOutput` is synthesized from the partial input (wrapped in
//   `_meta.payload`) while streaming — so `parsePayload()` reads from one
//   uniform shape for both phases.
// - Every field read from `toolOutput` MUST have a safe default. Arrays → [],
//   objects → {}, strings → '', numbers → 0, booleans → false. Never let
//   `undefined` propagate to JSX that will call `.map`/`.length`/`.toUpperCase`.
// - While streaming, every interactive control MUST be disabled (see the
//   `<fieldset disabled={isStreaming}>` wrapper below). Rationale: partials
//   re-fire many times per second; inputs bound to `data.*` would be wiped
//   on every re-render, and mutating clicks would send `sendFollowUpMessage`
//   against a half-complete payload.
// - Full worked example: `references/ref-progressive-rendering.tsx`.

export interface MainComponentProps {
  /** Data returned from the MCP tool. While `isStreaming=true` this is
   *  synthesized from the partial input stream (wrapped as `_meta.payload`). */
  toolOutput?: Record<string, unknown> | undefined;
  /** Input data sent to the tool (when available). */
  toolInput?: Record<string, unknown>;
  /** True while the host is streaming partial tool input; `toolOutput` is
   *  derived from the partial and will be replaced by the real tool-result.
   *  Every interactive control must be disabled while this is true. */
  isStreaming?: boolean;
  /** Host-persisted widget state for UI-only concerns (filters, selections). */
  widgetState: Record<string, unknown>;
  setWidgetState: (
    next:
      | Record<string, unknown>
      | ((prev: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
  /** Call an MCP tool by name with optional arguments. */
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** Send a follow-up message to the host conversation for write-back operations. */
  sendFollowUpMessage: (prompt: string) => Promise<void>;
  /** Display mode: 'inline' | 'inline-card' | 'fullscreen' | 'pip' */
  displayMode: string;
  /** Available display modes that can be requested. */
  availableDisplayModes: string[];
  /** Request a different display mode from the host. */
  requestDisplayMode: (mode: 'inline' | 'fullscreen' | 'pip') => Promise<void>;
  /** Theme from the host ('light' or 'dark'). */
  theme: string;
  /** Locale from the host (e.g., 'en-US'). */
  locale: string;
  /** Safe area insets for layout constraints (especially important in fullscreen mode). */
  safeArea: { top: number; right: number; bottom: number; left: number };
  /** Viewport dimensions from the host. */
  viewport: { width: number; height: number };
  /** Platform identifier from the host (e.g., 'web', 'ios', 'android'). */
  platform: string;
}

/**
 * parsePayload — defensive extraction for progressive + final renders.
 *
 * Handles three envelope shapes uniformly:
 *   A) { _meta: { payload: {...} } }  — canonical relay envelope (and the
 *                                       synthesized shape during streaming)
 *   B) {...}                          — flat structuredContent
 *   C) {} / undefined                 — pre-first-partial or empty
 *
 * EVERY field defaults to a safe value. Arrays → [], objects → {},
 * strings → '', numbers → 0, booleans → false. Never let `undefined`
 * propagate to JSX that will do `.map` / `.length` / `.toUpperCase`.
 *
 * Shape this function to match the tool's outputStructure + _meta spec.
 * Reference: `references/ref-progressive-rendering.tsx`.
 */
function parsePayload(toolOutput?: Record<string, unknown>) {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<
    string,
    unknown
  >;
  const rawItems = payload.items;
  return {
    title: typeof payload.title === 'string' ? payload.title : '',
    // TODO: Add every field from your tool's outputStructure here with a
    // typed default. Required AND optional fields alike. The defaults cover
    // the partial-input stream where fields may be absent or null.
    items: Array.isArray(rawItems) ? (rawItems as unknown[]) : [],
  };
}

/**
 * MainComponent — PRIMARY EDIT POINT
 *
 * Replace the placeholder below with your implementation.
 * For display mode view examples, read `references/ref-display-mode-views.tsx`.
 * For progressive-rendering + defensive-parsing examples, read
 * `references/ref-progressive-rendering.tsx`.
 */
export function MainComponent(props: MainComponentProps) {
  const { toolOutput, displayMode, isStreaming } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Skeleton gates on hasAnyRenderableData, not `!toolOutput`. As soon as
  // the first partial delivers any array entry or key field, the skeleton
  // gives way to the real (growing) UI — typically within 1–3s of the user
  // submitting, not 30–90s later when the LLM finishes synthesis.
  const hasAnyRenderableData = data.items.length > 0 || !!data.title;
  const isLoading = !toolOutput && !hasAnyRenderableData;

  // Loading skeleton: shown while there is nothing renderable at all.
  // TODO: Replace this generic skeleton with a layout matching your component's actual structure.
  if (isLoading) {
    return (
      <div
        className="h-full overflow-y-auto bg-background p-6"
        data-testid="loading-skeleton"
      >
        <div className="mx-auto max-w-3xl">
          <div className="mb-6">
            <div className="mb-3 h-6 w-48 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
          </div>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="mb-4 rounded-lg border border-border bg-card p-5"
            >
              <div className="mb-3 h-4 w-3/5 animate-pulse rounded-md bg-muted" />
              <div className="mb-2 h-3 w-full animate-pulse rounded-md bg-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // CRITICAL: <fieldset disabled={isStreaming}> makes every descendant
  // <button>, <input>, <textarea>, <select> read-only during streaming.
  // This prevents user input from being wiped by the next partial re-render
  // and prevents mutating clicks from firing against a half-complete payload.
  // The subtree re-enables the instant toolOutput arrives (tool-result).
  //
  // `aria-busy` announces the streaming state to screen readers.
  // TODO: Replace with your implementation.
  // Use `displayMode` to render different views: 'inline', 'inline-card', 'fullscreen', 'pip'.
  // For examples, read `references/ref-display-mode-views.tsx`.
  return (
    <div
      className="h-full overflow-y-auto bg-background"
      aria-busy={isStreaming ? 'true' : 'false'}
    >
      <StreamingIndicator visible={!!isStreaming} />
      <fieldset disabled={isStreaming} className="contents">
        {/* Each section: `{data.items.length > 0 && (...)}` — never render a
            zero-state badge while isStreaming, it causes flicker.
            Do NOT put `<input value={data.x} />` outside this fieldset. */}
        <div className="p-4">
          <p className="text-sm text-foreground">{data.title || 'Ready'}</p>
          <p className="text-xs text-muted-foreground">
            Display mode: {displayMode}
          </p>
        </div>
      </fieldset>
    </div>
  );
}

/**
 * Non-invasive streaming indicator. Subtle pulsing dot + "Generating…" chip
 * in the top-right. Does NOT block content, does NOT overlay, does NOT
 * reflow layout. Users can read the partially-rendered content underneath.
 *
 * i18n: add `"streaming.generating": "Generating…"` to locales/en-US.json
 * when localizing your component.
 */
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

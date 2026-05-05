/**
 * Reference: Display Mode View Examples
 *
 * Copy destination: src/components/main-component.tsx
 * Import paths below are relative to that destination, not this file's location.
 *
 * Copy and adapt the views you need into main-component.tsx.
 * Import layouts from './layouts.js' (WidgetLayout, InlineCardLayout, FullscreenLayout, PipLayout).
 * Remove unused display mode views after implementation.
 */

import { WidgetLayout } from './layouts.js';

// =============================================================================
// INLINE VIEW — Lightweight content in chat flow (default)
// =============================================================================

function InlineView({ data }: { data: { title: string } }) {
  return (
    <WidgetLayout displayMode="inline">
      <div className="w-full space-y-2">
        <p className="text-sm font-semibold text-foreground">{data.title}</p>
        {/* Add inline content here */}
      </div>
    </WidgetLayout>
  );
}

// =============================================================================
// INLINE-CARD VIEW — Card container with title, actions (1-2 max)
// =============================================================================

function InlineCardView({
  data,
  onExpand,
}: {
  data: { title: string };
  onExpand?: () => void;
}) {
  return (
    <WidgetLayout displayMode="inline-card">
      <div className="w-full flex flex-col">
        {/* Card Header */}
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold text-card-foreground">
            {data.title}
          </h3>
          {onExpand && (
            <button
              onClick={onExpand}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-transparent hover:border-border"
              aria-label="Expand to fullscreen"
            >
              Expand
            </button>
          )}
        </div>

        {/* Card Content */}
        <div className="px-4 py-3 space-y-3">{/* Add card content here */}</div>

        {/* Card Actions - Max 2 actions */}
        <div className="px-4 py-3 border-t flex gap-2">
          <button className="flex-1 inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Action
          </button>
        </div>
      </div>
    </WidgetLayout>
  );
}

// =============================================================================
// FULLSCREEN VIEW — Immersive experience with safeArea insets
// =============================================================================

function FullscreenView({
  data,
  safeArea,
}: {
  data: { title: string };
  safeArea: { top: number; right: number; bottom: number; left: number };
}) {
  return (
    <WidgetLayout displayMode="fullscreen" safeArea={safeArea}>
      <div className="w-full h-full flex flex-col">
        {/* Fullscreen Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-lg font-semibold text-foreground">
            {data.title}
          </h2>
        </div>

        {/* Fullscreen Content — scrollable */}
        <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
          {/* Add fullscreen content here */}
        </div>

        {/* Fullscreen Actions */}
        <div className="px-4 py-3 border-t flex gap-2">
          <button className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Action
          </button>
        </div>
      </div>
    </WidgetLayout>
  );
}

// =============================================================================
// PIP VIEW — Persistent floating window for ongoing sessions
// =============================================================================

function PictureInPictureView({ data }: { data: { title: string } }) {
  return (
    <WidgetLayout displayMode="pip">
      <div className="w-full flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <h4 className="text-xs font-semibold text-card-foreground">
            {data.title}
          </h4>
        </div>
        <div className="px-3 py-3 space-y-2">
          {/* Keep PiP content minimal */}
        </div>
      </div>
    </WidgetLayout>
  );
}

// =============================================================================
// USAGE PATTERN — Switch on displayMode in your MainComponent
// =============================================================================

/*
export function MainComponent(props: MainComponentProps) {
  const { displayMode, safeArea } = props;

  if (displayMode === 'fullscreen') {
    return <FullscreenView data={data} safeArea={safeArea} />;
  }
  if (displayMode === 'pip') {
    return <PictureInPictureView data={data} />;
  }
  if (displayMode === 'inline-card') {
    return <InlineCardView data={data} onExpand={() => requestDisplayMode('fullscreen')} />;
  }
  // Default: inline
  return <InlineView data={data} />;
}
*/

// Suppress unused warnings — these are reference examples, not meant to be imported directly
void InlineView;
void InlineCardView;
void FullscreenView;
void PictureInPictureView;

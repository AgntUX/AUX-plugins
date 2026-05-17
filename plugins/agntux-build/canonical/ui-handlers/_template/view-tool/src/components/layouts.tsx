import type { ReactNode } from 'react';

type DisplayMode = 'inline' | 'inline-card' | 'fullscreen' | 'pip' | undefined;

interface LayoutProps {
  displayMode?: DisplayMode;
  maxHeight?: number;
  safeArea?: { top: number; right: number; bottom: number; left: number };
  children: ReactNode;
}

/**
 * InlineLayout keeps content within the normal chat flow.
 * Use this for the default widget experience - lightweight content that appears
 * before the model response. No card styling, minimal padding.
 *
 * Inline viewport budget: the host gives inline iframes ~400-600px of height.
 * Pass `maxHeight` (from `viewport.height` or
 * `hostContext.containerDimensions.maxHeight`) to pin a specific budget — when
 * passed, the layout fills its parent and scrolls overflow internally.
 * Without `maxHeight`, the layout keeps its intrinsic height so it fits
 * gracefully inside block-flow parents that don't declare a height.
 */
export function InlineLayout({ maxHeight, children }: LayoutProps) {
  return (
    <div
      className={
        maxHeight !== undefined
          ? 'w-full h-full overflow-y-auto'
          : 'w-full overflow-y-auto'
      }
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * InlineCardLayout renders content inside a card-like container.
 * This is well-suited to small, focused widgets with 1-2 primary actions.
 * Includes title, expand button, and action buttons at the bottom.
 *
 * Rules:
 * - Limit to 2 actions maximum (one primary, one optional secondary)
 * - No deep navigation or multiple views within a card
 * - No nested scrolling - card should auto-fit content
 * - No duplicative inputs - don't replicate host features
 */
export function InlineCardLayout({ maxHeight, children }: LayoutProps) {
  return (
    <div
      className={
        maxHeight !== undefined
          ? 'w-full h-full overflow-y-auto rounded-lg border bg-card text-card-foreground shadow-sm'
          : 'w-full overflow-y-auto rounded-lg border bg-card text-card-foreground shadow-sm'
      }
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * InlineCarouselLayout renders a horizontal scrolling carousel.
 * Use for presenting 3-8 similar items side-by-side.
 *
 * Rules:
 * - Keep to 3-8 items for scannability
 * - Each item should include an image or visual
 * - Reduce metadata to most relevant details (max 3 lines)
 * - Each card may have a single, optional CTA
 * - Use consistent visual hierarchy across cards
 */
export function InlineCarouselLayout({ maxHeight, children }: LayoutProps) {
  return (
    <div className="w-full" style={maxHeight ? { maxHeight } : undefined}>
      <div className="flex gap-4 overflow-x-auto pb-2 scroll-smooth snap-x snap-mandatory">
        {children}
      </div>
    </div>
  );
}

/**
 * FullscreenLayout is appropriate when the host has granted fullscreen
 * displayMode. It removes most internal padding so the widget can manage
 * its own sub-layouts. Applies safeArea insets for proper spacing.
 *
 * The host composer remains overlaid, allowing users to continue
 * "talking to the app" through natural conversation.
 *
 * Rules:
 * - Design UX to work with the system composer (always present)
 * - Use fullscreen to deepen engagement, not replicate native app wholesale
 */
export function FullscreenLayout({ safeArea, children }: LayoutProps) {
  const paddingStyle = safeArea
    ? {
        paddingTop: `${safeArea.top}px`,
        paddingRight: `${safeArea.right}px`,
        paddingBottom: `${safeArea.bottom}px`,
        paddingLeft: `${safeArea.left}px`,
      }
    : undefined;

  return (
    <div
      className="w-full h-full bg-background text-foreground flex flex-col"
      style={paddingStyle}
    >
      {children}
    </div>
  );
}

/**
 * PictureInPictureLayout renders a persistent floating window.
 * Use for ongoing or live sessions like games or videos.
 *
 * Rules:
 * - Ensure PiP state can update or respond to chat input
 * - Close PiP automatically when session ends
 * - Do not overload PiP with controls or static content
 */
export function PictureInPictureLayout({ maxHeight, children }: LayoutProps) {
  return (
    <div
      className="w-full rounded-lg border bg-card text-card-foreground shadow-lg"
      style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Best-effort layout chooser based on the displayMode hint from the host.
 * The coding agent may keep this helper or inline equivalent logic.
 *
 * Display modes:
 * - 'inline': Lightweight content in chat flow (default)
 * - 'inline-card': Card container with title, actions (1-2 max)
 * - 'fullscreen': Immersive experience with safeArea insets
 * - 'pip': Persistent floating window for ongoing sessions
 */
export function WidgetLayout(props: LayoutProps) {
  const { displayMode, maxHeight, safeArea, children } = props;

  if (displayMode === 'fullscreen') {
    return (
      <FullscreenLayout displayMode={displayMode} safeArea={safeArea}>
        {children}
      </FullscreenLayout>
    );
  }

  if (displayMode === 'pip') {
    return (
      <PictureInPictureLayout displayMode={displayMode} maxHeight={maxHeight}>
        {children}
      </PictureInPictureLayout>
    );
  }

  if (displayMode === 'inline-card') {
    return (
      <InlineCardLayout displayMode={displayMode} maxHeight={maxHeight}>
        {children}
      </InlineCardLayout>
    );
  }

  // Default: inline
  return (
    <InlineLayout displayMode={displayMode} maxHeight={maxHeight}>
      {children}
    </InlineLayout>
  );
}

/**
 * Inline viewport budget test utilities.
 *
 * The host gives inline MCP App iframes ~400-600px of height. Every component
 * MUST remain fully usable at 600px tall via internal scrolling. These helpers
 * make that budget explicit in tests.
 */

import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

export interface InlineViewportOptions {
  /** Height of the simulated iframe in pixels. Default: 600 */
  height?: number;
  /** Width of the simulated iframe in pixels. Default: 400 */
  width?: number;
}

export interface InlineViewportResult extends RenderResult {
  /**
   * The fixed-size iframe wrapper. Use this (not `document.body`) as the
   * query root when asserting overflow / scroll behavior.
   */
  viewport: HTMLElement;
  /** The configured height in pixels. */
  height: number;
  /** The configured width in pixels. */
  width: number;
}

/**
 * Render a component inside a fixed-size wrapper that matches the host's
 * inline iframe budget (default 400x600). Use this to assert that:
 *  - the component's root container is scrollable (`scrollHeight > clientHeight`);
 *  - the primary action node is reachable via `scrollIntoView()`;
 *  - no descendant uses forbidden heights (`min-h-screen`, `100vh`).
 *
 * @example
 * ```tsx
 * const { viewport, getByRole } = renderAtInlineViewport(<MyComponent />);
 * expect(viewport.firstElementChild).toBeInstanceOf(HTMLElement);
 * const submit = getByRole('button', { name: /save/i });
 * submit.scrollIntoView();
 * expect(submit).toBeVisible();
 * ```
 */
export function renderAtInlineViewport(
  ui: ReactElement,
  options: InlineViewportOptions = {},
): InlineViewportResult {
  const height = options.height ?? 600;
  const width = options.width ?? 400;

  const viewport = document.createElement('div');
  viewport.setAttribute('data-testid', 'inline-viewport');
  viewport.style.height = `${height}px`;
  viewport.style.width = `${width}px`;
  viewport.style.overflow = 'hidden';
  viewport.style.position = 'relative';
  document.body.appendChild(viewport);

  const result = render(ui, { container: viewport });

  return { ...result, viewport, height, width };
}

const SCROLL_CLASSES = [
  'overflow-y-auto',
  'overflow-y-scroll',
  'overflow-auto',
  'overflow-scroll',
];

function isElementScrollable(el: HTMLElement): boolean {
  if (SCROLL_CLASSES.some((c) => el.classList.contains(c))) return true;
  const inline = el.style.overflowY || el.style.overflow;
  if (inline === 'auto' || inline === 'scroll') return true;
  const style = window.getComputedStyle(el);
  return style.overflowY === 'auto' || style.overflowY === 'scroll';
}

/**
 * Returns true when the element itself is a scroll container OR when it
 * delegates scroll to its single wrapper child (common for layouts that
 * put the scroll container one level deep). Walking arbitrarily deep would
 * return true for any component with an internal scrollable region (e.g., a
 * nested modal body), which is not the assertion we want at the root.
 */
export function rootIsScrollable(element: HTMLElement): boolean {
  if (isElementScrollable(element)) return true;
  if (element.children.length !== 1) return false;
  const only = element.firstElementChild;
  if (!(only instanceof HTMLElement)) return false;
  return isElementScrollable(only);
}

/**
 * @deprecated Prefer `rootIsScrollable`. Retained as an alias for back-compat.
 */
export const hasScrollableRoot = rootIsScrollable;

/**
 * Regex fragments for the banned anti-patterns. Use in source-code scans.
 */
export const BANNED_HEIGHT_CLASSES = [
  'min-h-screen',
  'h-screen',
  '100vh',
  '100dvh',
];

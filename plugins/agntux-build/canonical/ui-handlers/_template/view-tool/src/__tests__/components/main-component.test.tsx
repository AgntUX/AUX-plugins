/**
 * MainComponent Test Suite
 *
 * Replace the placeholder tests below with tests for your component.
 * Map each testCase from prd.json to a test implementation.
 *
 * Test patterns available in `references/ref-test-patterns.tsx`:
 * - Display mode tests (inline, inline-card, fullscreen, pip)
 * - Tool interaction tests (callTool, sendFollowUpMessage)
 * - State management tests (widgetState updates)
 * - Empty/error state tests
 * - Accessibility tests (ARIA labels, keyboard navigation)
 *
 * Progressive-rendering tests at the bottom of this file exercise the
 * streaming pathway (tool-input-partial → tool-result). Keep them green
 * when you replace the placeholder logic — they verify the invariants
 * documented in `references/ref-progressive-rendering.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { App } from '../../App.js';
import { MainComponent } from '../../components/main-component.js';
import {
  render,
  screen,
  waitFor,
  createMainComponentProps,
  renderAtInlineViewport,
  renderWithProvider,
  rootIsScrollable,
  BANNED_HEIGHT_CLASSES,
} from '../test-utils/index.js';

// =============================================================================
// PLACEHOLDER TESTS — Replace with your ticket's testCases
// =============================================================================

describe('MainComponent', () => {
  it('renders without crashing', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Test' },
    });

    render(<MainComponent {...props} />);

    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('shows loading skeleton when toolOutput is undefined', () => {
    const { props } = createMainComponentProps({
      toolOutput: undefined,
    });

    const { container } = render(<MainComponent {...props} />);

    // Loading skeleton uses Tailwind animate-pulse classes
    const pulseElements = container.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it('renders without errors regardless of theme prop value', () => {
    for (const theme of ['light', 'dark']) {
      const { props } = createMainComponentProps({
        toolOutput: { title: 'Theme test' },
        theme,
      });

      const { container } = render(<MainComponent {...props} />);
      expect(container).toBeInTheDocument();
    }
  });

  it('uses semantic color classes in loading skeleton', () => {
    const { props } = createMainComponentProps({
      toolOutput: undefined,
    });

    const { container } = render(<MainComponent {...props} />);

    // Verify semantic Tailwind color classes are used
    expect(container.querySelector('.bg-background')).toBeInTheDocument();
    expect(container.querySelector('.bg-card')).toBeInTheDocument();
    expect(container.querySelector('.border-border')).toBeInTheDocument();
    expect(container.querySelector('.bg-muted')).toBeInTheDocument();
  });

  // Example: mapping a prd.json testCase to a test
  //
  // | prd.json testCase                      | Test Implementation                              |
  // |----------------------------------------|--------------------------------------------------|
  // | "Deal card renders from toolOutput"    | it('renders deal card from toolOutput', ...)      |
  // | "Empty state shows when no deals"      | it('shows empty state when no deals', ...)        |
  // | "Refresh button calls refresh tool"    | it('calls refresh tool on button click', ...)     |
  //
  // See `references/ref-test-patterns.tsx` for complete examples of each pattern.
});

// =============================================================================
// INLINE VIEWPORT BUDGET — every component must pass these at 600px tall
// =============================================================================

describe('MainComponent — inline viewport budget (600px tall)', () => {
  it('root of loading skeleton is a scrollable container, not min-h-screen', () => {
    const { props } = createMainComponentProps({ toolOutput: undefined });
    const { viewport } = renderAtInlineViewport(<MainComponent {...props} />);
    const root = viewport.firstElementChild;
    expect(root).toBeInstanceOf(HTMLElement);
    expect(rootIsScrollable(root as HTMLElement)).toBe(true);
  });

  it('loading skeleton does not use banned viewport-height classes', () => {
    const { props } = createMainComponentProps({ toolOutput: undefined });
    const { viewport } = renderAtInlineViewport(<MainComponent {...props} />);
    const html = viewport.innerHTML;
    for (const banned of BANNED_HEIGHT_CLASSES) {
      expect(html).not.toContain(banned);
    }
  });

  it('rendered content does not use banned viewport-height classes', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Ready' },
    });
    const { viewport } = renderAtInlineViewport(<MainComponent {...props} />);
    const html = viewport.innerHTML;
    for (const banned of BANNED_HEIGHT_CLASSES) {
      expect(html).not.toContain(banned);
    }
  });
});

// =============================================================================
// PROGRESSIVE RENDERING — every component must pass these
//
// These tests verify the component handles the three-notification lifecycle
// (tool-input-partial × N → tool-input → tool-result) without crashing, and
// that interactive controls stay disabled while `isStreaming=true`.
// =============================================================================

describe('MainComponent — progressive rendering', () => {
  it('renders the streaming indicator (role=status) while isStreaming=true', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Partial' },
      isStreaming: true,
    });
    render(<MainComponent {...props} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('hides the streaming indicator once the real tool-result arrives', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Final' },
      isStreaming: false,
    });
    render(<MainComponent {...props} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('sets aria-busy=true on the scroll container while streaming', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Partial' },
      isStreaming: true,
    });
    const { container } = render(<MainComponent {...props} />);
    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl).not.toBeNull();
  });

  it('wraps interactive region in a disabled fieldset while streaming', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Partial' },
      isStreaming: true,
    });
    const { container } = render(<MainComponent {...props} />);
    const fieldset = container.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    expect(fieldset).toBeDisabled();
  });

  it('re-enables the fieldset once streaming ends', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Final' },
      isStreaming: false,
    });
    const { container } = render(<MainComponent {...props} />);
    const fieldset = container.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    expect(fieldset).not.toBeDisabled();
  });

  it('unwraps canonical _meta.payload envelope (shape A)', () => {
    const { props } = createMainComponentProps({
      toolOutput: { _meta: { payload: { title: 'From meta' } } },
    });
    render(<MainComponent {...props} />);
    expect(screen.getByText('From meta')).toBeInTheDocument();
  });

  it('reads flat structuredContent as payload (shape B)', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Flat' },
    });
    render(<MainComponent {...props} />);
    expect(screen.getByText('Flat')).toBeInTheDocument();
  });

  it('tolerates partial envelopes with missing/null fields without throwing', () => {
    const malformedPayloads: Array<Record<string, unknown>> = [
      {},
      { _meta: { payload: {} } },
      { _meta: { payload: { items: null } } },
      { _meta: { payload: { items: [{}] } } },
      {
        _meta: {
          payload: {
            items: [{ id: null, name: undefined, nested: { a: null } }],
          },
        },
      },
      { items: null as unknown as unknown[] },
    ];
    for (const toolOutput of malformedPayloads) {
      const { props } = createMainComponentProps({
        toolOutput,
        isStreaming: true,
      });
      expect(() => render(<MainComponent {...props} />)).not.toThrow();
    }
  });
});

// =============================================================================
// APP-LEVEL STREAMING — exercises the App.tsx wiring of useOnToolInputPartial
//
// These tests render the full <App /> and use the mock adapter to simulate
// the three-notification lifecycle. They verify that a partial-input
// stream clears the skeleton and that the final tool-result replaces the
// synthesized envelope without errors.
// =============================================================================

describe('App — tool-input-partial integration', () => {
  it('skeleton disappears once the first partial contains renderable data', async () => {
    const { adapter } = renderWithProvider(<App />, {
      adapterOptions: { initialToolOutput: undefined },
    });
    // Trigger the dev-mode bypass so the gate passes through to MainComponent.
    // In vitest import.meta.env.DEV is true; providing empty meta surface
    // the missing-token path which is bypassed in dev mode.
    act(() => {
      adapter.setResourceMeta({});
    });
    await waitFor(() =>
      expect(screen.queryByTestId('loading-skeleton')).toBeInTheDocument(),
    );
    act(() => {
      adapter.emitToolInputPartial({ title: 'Streaming…' });
    });
    await waitFor(() =>
      expect(screen.queryByTestId('loading-skeleton')).toBeNull(),
    );
  });

  it('final tool-result hides the streaming indicator and re-enables controls', async () => {
    const { adapter, container } = renderWithProvider(<App />, {
      adapterOptions: { initialToolOutput: undefined },
    });
    // Trigger dev-mode bypass so gate passes through to MainComponent.
    act(() => {
      adapter.setResourceMeta({});
    });
    await waitFor(() =>
      expect(screen.queryByTestId('loading-skeleton')).toBeInTheDocument(),
    );
    act(() => {
      adapter.emitToolInputPartial({ title: 'Partial' });
    });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeNull());
    const fieldsetWhileStreaming = container.querySelector('fieldset');
    expect(fieldsetWhileStreaming).toBeDisabled();

    act(() => {
      adapter.emitToolResult({ title: 'Final' });
    });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    const fieldsetAfterResult = container.querySelector('fieldset');
    expect(fieldsetAfterResult).not.toBeDisabled();
  });

  it('handles a burst of partials with missing/null fields without throwing', () => {
    const { adapter } = renderWithProvider(<App />, {
      adapterOptions: { initialToolOutput: undefined },
    });
    expect(() => {
      act(() => {
        adapter.emitToolInputPartial({});
        adapter.emitToolInputPartial({
          items: null as unknown as unknown[],
        });
        adapter.emitToolInputPartial({ items: [{}] });
        adapter.emitToolInputPartial({
          items: [{ id: null, name: undefined }],
        });
      });
    }).not.toThrow();
  });
});

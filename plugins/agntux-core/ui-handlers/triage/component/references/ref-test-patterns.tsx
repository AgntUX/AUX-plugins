/**
 * Reference: Test Patterns for MCP App Components
 *
 * Copy destination: src/__tests__/components/main-component.test.tsx
 * Import paths below are relative to that destination, not this file's location.
 *
 * Copy and adapt the patterns you need into main-component.test.tsx.
 * Each section demonstrates a different test category.
 */

import { describe, it, expect, vi } from 'vitest';
import { MainComponent } from '../../components/main-component.js';
import {
  render,
  screen,
  userEvent,
  createMainComponentProps,
} from '../test-utils/index.js';

// =============================================================================
// 1. DISPLAY MODE TESTS
// =============================================================================

describe('Display Modes', () => {
  it('renders inline view by default', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Test Title' },
    });
    render(<MainComponent {...props} />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders fullscreen view', () => {
    const { props } = createMainComponentProps({
      displayMode: 'fullscreen',
      toolOutput: { title: 'Fullscreen' },
    });
    render(<MainComponent {...props} />);
    expect(screen.getByText('Fullscreen')).toBeInTheDocument();
  });
});

// =============================================================================
// 2. TOOL INTERACTION TESTS
// =============================================================================

describe('Tool Interactions', () => {
  it('calls tool when button is clicked', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: { title: 'Test' },
    });
    render(<MainComponent {...props} />);

    await user.click(screen.getByRole('button', { name: /refresh/i }));
    expect(callToolSpy).toHaveBeenCalledWith('refresh_data', { force: true });
  });

  it('handles tool call errors gracefully', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: { title: 'Test' },
    });
    callToolSpy.mockRejectedValueOnce(new Error('API error'));

    render(<MainComponent {...props} />);
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    expect(screen.getByText(/error/i)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});

// =============================================================================
// 3. STATE MANAGEMENT TESTS
// =============================================================================

describe('State Management', () => {
  it('updates widget state on user action', async () => {
    const user = userEvent.setup();
    const { props, getWidgetState } = createMainComponentProps({
      toolOutput: { title: 'Test' },
      widgetState: { selectedTab: 'overview' },
    });
    render(<MainComponent {...props} />);

    await user.click(screen.getByRole('tab', { name: /details/i }));
    expect(getWidgetState()).toEqual({ selectedTab: 'details' });
  });

  it('preserves existing state when updating', async () => {
    const user = userEvent.setup();
    const { props, getWidgetState } = createMainComponentProps({
      toolOutput: { title: 'Test' },
      widgetState: { filter: 'active', selectedTab: 'overview' },
    });
    render(<MainComponent {...props} />);

    await user.click(screen.getByRole('tab', { name: /details/i }));
    const state = getWidgetState();
    expect(state.filter).toBe('active'); // preserved
    expect(state.selectedTab).toBe('details'); // updated
  });
});

// =============================================================================
// 4. EMPTY / ERROR STATE TESTS
// =============================================================================

describe('Edge Cases', () => {
  it('shows loading skeleton when toolOutput is undefined', () => {
    const { props } = createMainComponentProps({ toolOutput: undefined });
    const { container } = render(<MainComponent {...props} />);
    expect(container.querySelector('.skeleton-item')).toBeInTheDocument();
  });

  it('shows empty state when data array is empty', () => {
    const { props } = createMainComponentProps({
      toolOutput: { items: [] },
    });
    render(<MainComponent {...props} />);
    expect(screen.getByText(/no items/i)).toBeInTheDocument();
  });

  it('handles null widgetState gracefully', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Test' },
      // @ts-expect-error - testing edge case
      widgetState: null,
    });
    expect(() => render(<MainComponent {...props} />)).not.toThrow();
  });
});

// =============================================================================
// 5. ACCESSIBILITY TESTS
// =============================================================================

describe('Accessibility', () => {
  it('interactive elements have accessible names', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Test' },
    });
    render(<MainComponent {...props} />);

    // All buttons should be findable by role + name
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
  });

  it('form inputs have labels', () => {
    const { props } = createMainComponentProps({
      toolOutput: { title: 'Test' },
    });
    render(<MainComponent {...props} />);

    const input = screen.getByRole('textbox', { name: /search/i });
    expect(input).toBeInTheDocument();
  });
});

// Suppress unused — these are reference examples
void 0;

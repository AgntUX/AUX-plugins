/**
 * Test render utilities for component testing
 *
 * Provides wrappers around React Testing Library for testing
 * components with the Apps SDK.
 */

import type { ReactElement, JSX } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import { AppsProvider } from '../../lib/apps-react/index.js';
import type { HostContext } from '../../lib/apps-client/index.js';
import {
  type MockAdapterOptions,
  TestMockAdapter,
  createTestMockAdapter,
} from './mock-adapter.js';
import type { MainComponentProps } from '../../components/main-component.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result from renderWithProvider, includes the adapter for test assertions
 */
export interface RenderWithProviderResult extends RenderResult {
  /** The test mock adapter for controlling the test environment */
  adapter: TestMockAdapter;
}

/**
 * Options for renderWithProvider
 */
export interface RenderWithProviderOptions {
  /** Options for the mock adapter */
  adapterOptions?: MockAdapterOptions;
}

// =============================================================================
// TEST CLIENT
// =============================================================================

/**
 * Creates a test client that wraps the TestMockAdapter
 * This implements the minimal AppsClient interface needed by AppsProvider
 */
function createTestClient(adapter: TestMockAdapter) {
  // We need to connect the adapter before using
  void adapter.connect();

  return {
    // Tool operations
    callTool: async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<unknown> => {
      return adapter.callTool(name, args);
    },
    tools: new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop.startsWith('call') && prop.length > 4) {
            const toolName = prop.charAt(4).toLowerCase() + prop.slice(5);
            return async (args: unknown) => {
              return adapter.callTool(
                toolName,
                args as Record<string, unknown>,
              );
            };
          }
          return undefined;
        },
      },
    ),

    // Messaging
    sendMessage: async (content: { type: string; text: string }) => {
      await adapter.sendMessage(content);
    },
    sendFollowUpMessage: async (prompt: string) => {
      await adapter.sendMessage({ type: 'text', text: prompt });
    },

    // Model context
    updateModelContext: async (params: Record<string, unknown>) => {
      await adapter.updateModelContext(params);
    },

    // Navigation
    openLink: async (url: string) => {
      await adapter.openLink(url);
    },
    requestDisplayMode: async (mode: 'inline' | 'fullscreen' | 'pip') => {
      return adapter.requestDisplayMode(mode);
    },
    requestClose: () => {
      adapter.requestClose();
    },

    // State
    getState: function <S>(): S | null {
      return adapter.getState<S>();
    },
    setState: function <S>(state: S) {
      adapter.setState(state);
    },

    // Resources
    readResource: async (uri: string) => {
      return adapter.readResource(uri);
    },

    // Logging
    log: (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => {
      adapter.log(level, data);
    },

    // Events
    onToolResult: (handler: (result: unknown) => void) => {
      return adapter.onToolResult(handler);
    },
    onToolInput: (handler: (input: unknown) => void) => {
      return adapter.onToolInput(handler as (input: unknown) => void);
    },
    onToolCancelled: (handler: (reason?: string) => void) => {
      return adapter.onToolCancelled(handler);
    },
    onHostContextChange: (handler: (context: HostContext) => void) => {
      return adapter.onHostContextChange(handler);
    },
    onTeardown: (handler: (reason?: string) => void) => {
      return adapter.onTeardown(handler);
    },
    onToolInputPartial: (handler: (input: unknown) => void) => {
      return adapter.onToolInputPartial(handler as (input: unknown) => void);
    },

    // Host information
    getHostCapabilities: () => adapter.getHostCapabilities(),
    getHostVersion: () => adapter.getHostVersion(),

    // Protocol-level logging
    sendLog: async (
      level:
        | 'debug'
        | 'info'
        | 'notice'
        | 'warning'
        | 'error'
        | 'critical'
        | 'alert'
        | 'emergency',
      data: unknown,
    ) => {
      await adapter.sendLog(level, data);
    },

    // Size notifications
    sendSizeChanged: async (params: { width: number; height: number }) => {
      await adapter.sendSizeChanged(params);
    },
    setupSizeChangedNotifications: () => {
      return () => {
        /* no-op in tests */
      };
    },

    // Bidirectional tools
    setCallToolHandler: (
      handler: (
        toolName: string,
        args: Record<string, unknown>,
      ) => Promise<unknown>,
    ) => {
      adapter.setCallToolHandler(handler);
    },
    setListToolsHandler: (
      handler: () => Promise<
        Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>
      >,
    ) => {
      adapter.setListToolsHandler(handler);
    },

    // Current state accessors
    get hostContext(): HostContext {
      return adapter.getHostContext();
    },
    get toolInput(): Record<string, unknown> | undefined {
      return adapter.getToolInput();
    },
    get toolOutput(): Record<string, unknown> | undefined {
      return adapter.getToolOutput();
    },
    get toolMeta(): Record<string, unknown> | undefined {
      return adapter.getToolMeta();
    },
    get resourceMeta(): Record<string, unknown> | undefined {
      return adapter.getResourceMeta();
    },
    onResourceMetaChange: (
      handler: (meta: Record<string, unknown> | undefined) => void,
    ) => adapter.onResourceMetaChange(handler),
    sendNotification: async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      await adapter.sendNotification(method, params);
    },
  };
}

// =============================================================================
// RENDER UTILITIES
// =============================================================================

/**
 * Render a component wrapped in AppsProvider with a test mock adapter
 *
 * Use this for testing components that use hooks like useAppsClient,
 * useToolResult, etc.
 *
 * @example
 * ```tsx
 * import { renderWithProvider, screen } from '../test-utils';
 *
 * it('displays tool result', async () => {
 *   const { adapter } = renderWithProvider(<MyComponent />, {
 *     adapterOptions: { initialToolOutput: { data: 'test' } }
 *   });
 *
 *   expect(screen.getByText('test')).toBeInTheDocument();
 *
 *   // Emit new tool result
 *   adapter.emitToolResult({ data: 'updated' });
 *   expect(screen.getByText('updated')).toBeInTheDocument();
 * });
 * ```
 */
export function renderWithProvider(
  ui: ReactElement,
  options: RenderWithProviderOptions = {},
): RenderWithProviderResult {
  const adapter = createTestMockAdapter(options.adapterOptions);
  const client = createTestClient(adapter);

  const Wrapper = ({
    children,
  }: {
    children: React.ReactNode;
  }): JSX.Element => (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <AppsProvider client={client as any}>{children}</AppsProvider>
  );

  const result = render(ui, { wrapper: Wrapper });

  return { ...result, adapter };
}

// =============================================================================
// MAIN COMPONENT TESTING UTILITIES
// =============================================================================

/**
 * Default props for MainComponent testing
 */
export const defaultMainComponentProps: MainComponentProps = {
  toolOutput: undefined,
  toolInput: undefined,
  widgetState: {},
  setWidgetState: () => {
    /* no-op */
  },
  callTool: async () => {
    /* no-op */
  },
  sendFollowUpMessage: async () => {
    /* no-op */
  },
  openLink: async () => {
    /* no-op */
  },
  displayMode: 'inline',
  availableDisplayModes: ['inline', 'fullscreen', 'pip'],
  requestDisplayMode: async () => {
    /* no-op */
  },
  theme: 'light',
  locale: 'en-US',
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  viewport: { width: 800, height: 600 },
  platform: 'web',
};

/**
 * Options for createMainComponentProps
 */
export interface CreateMainComponentPropsOptions {
  /** Tool output data */
  toolOutput?: Record<string, unknown>;
  /** Tool input data */
  toolInput?: Record<string, unknown>;
  /** True while the host is still streaming partial tool input. */
  isStreaming?: boolean;
  /** Initial widget state */
  widgetState?: Record<string, unknown>;
  /** Display mode */
  displayMode?: string;
  /** Available display modes */
  availableDisplayModes?: string[];
  /** Theme */
  theme?: string;
  /** Locale */
  locale?: string;
  /** Safe area insets */
  safeArea?: { top: number; right: number; bottom: number; left: number };
  /** Viewport dimensions */
  viewport?: { width: number; height: number };
  /** Platform */
  platform?: string;
}

/**
 * Result from createMainComponentProps
 */
export interface MainComponentPropsResult {
  /** Props to pass to MainComponent */
  props: MainComponentProps;
  /** Spy for setWidgetState calls */
  setWidgetStateSpy: ReturnType<typeof vi.fn>;
  /** Spy for callTool calls */
  callToolSpy: ReturnType<typeof vi.fn>;
  /** Spy for sendFollowUpMessage calls */
  sendFollowUpMessageSpy: ReturnType<typeof vi.fn>;
  /** Spy for openLink calls */
  openLinkSpy: ReturnType<typeof vi.fn>;
  /** Spy for requestDisplayMode calls */
  requestDisplayModeSpy: ReturnType<typeof vi.fn>;
  /** Current widget state (updated by setWidgetState calls) */
  getWidgetState: () => Record<string, unknown>;
}

/**
 * Create props for testing MainComponent directly
 *
 * Use this for direct testing of MainComponent without the full
 * AppsProvider setup. Returns props with spies attached for assertions.
 *
 * @example
 * ```tsx
 * import { createMainComponentProps, render, screen } from '../test-utils';
 * import { MainComponent } from '../../components/main-component';
 *
 * it('calls tool on button click', async () => {
 *   const { props, callToolSpy } = createMainComponentProps({
 *     toolOutput: { title: 'Test' }
 *   });
 *
 *   render(<MainComponent {...props} />);
 *
 *   await userEvent.click(screen.getByRole('button', { name: /increment/i }));
 *
 *   expect(callToolSpy).toHaveBeenCalledWith('increment_counter', { count: 1 });
 * });
 * ```
 */
export function createMainComponentProps(
  options: CreateMainComponentPropsOptions = {},
): MainComponentPropsResult {
  let widgetState: Record<string, unknown> = options.widgetState ?? {};

  const setWidgetStateSpy = vi.fn(
    (
      next:
        | Record<string, unknown>
        | ((prev: Record<string, unknown>) => Record<string, unknown>),
    ) => {
      if (typeof next === 'function') {
        widgetState = next(widgetState);
      } else {
        widgetState = next;
      }
    },
  );

  const callToolSpy = vi.fn(async () => {
    /* no-op */
  });

  const sendFollowUpMessageSpy = vi.fn(async () => {
    /* no-op */
  });

  const openLinkSpy = vi.fn(async () => {
    /* no-op */
  });

  const requestDisplayModeSpy = vi.fn(async () => {
    /* no-op */
  });

  const props: MainComponentProps = {
    ...defaultMainComponentProps,
    toolOutput: options.toolOutput,
    toolInput: options.toolInput,
    isStreaming: options.isStreaming,
    widgetState,
    setWidgetState: setWidgetStateSpy,
    callTool: callToolSpy,
    sendFollowUpMessage: sendFollowUpMessageSpy,
    openLink: openLinkSpy,
    displayMode: options.displayMode ?? 'inline',
    availableDisplayModes:
      options.availableDisplayModes ??
      defaultMainComponentProps.availableDisplayModes,
    requestDisplayMode: requestDisplayModeSpy,
    theme: options.theme ?? 'light',
    locale: options.locale ?? 'en-US',
    safeArea: options.safeArea ?? defaultMainComponentProps.safeArea,
    viewport: options.viewport ?? defaultMainComponentProps.viewport,
    platform: options.platform ?? 'web',
  };

  return {
    props,
    setWidgetStateSpy,
    callToolSpy,
    sendFollowUpMessageSpy,
    openLinkSpy,
    requestDisplayModeSpy,
    getWidgetState: () => widgetState,
  };
}

// Re-export testing library utilities
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';

/**
 * React hooks for apps-react
 *
 * Inlined from @mcp-apps-kit/ui-react v0.5.0
 * Source: https://github.com/agntux/mcp-apps-kit
 * Date: 2026-01-24
 */

import type { RefObject } from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  AppsClient,
  HostContext,
  ToolDefs,
  ToolResult,
  ClientDebugConfig,
  HostCapabilities,
  HostVersion,
  UpdateModelContextParams,
} from '../apps-client/index.js';
import {
  clientDebugLogger,
  type ClientDebugLogger,
} from '../apps-client/index.js';
import { useAppsContext } from './context.js';

// =============================================================================
// SHARED UTILITIES
// =============================================================================

/** Default host context for initial state */
const DEFAULT_HOST_CONTEXT: HostContext = {
  theme: 'light',
  displayMode: 'inline',
  availableDisplayModes: ['inline'],
  viewport: { width: 0, height: 0 },
  locale: 'en-US',
  platform: 'web',
};

/** Default safe area insets */
const DEFAULT_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Helper to create a ResizeObserver that reports size changes
 */
function createSizeObserver(
  element: HTMLElement,
  onResize: (width: number, height: number) => void,
): ResizeObserver {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      onResize(Math.round(width), Math.round(height));
    }
  });

  observer.observe(element);

  // Report initial size
  const rect = element.getBoundingClientRect();
  onResize(Math.round(rect.width), Math.round(rect.height));

  return observer;
}

// =============================================================================
// CORE HOOKS
// =============================================================================

/**
 * Access the typed client instance
 *
 * @returns Client instance
 * @throws Error if used outside AppsProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const client = useAppsClient<typeof app.tools>();
 *
 *   const handleClick = async () => {
 *     await client.callTool("myTool", { arg: "value" });
 *   };
 *
 *   return <button onClick={handleClick}>Call Tool</button>;
 * }
 * ```
 */
export function useAppsClient<T extends ToolDefs = ToolDefs>(): AppsClient<T> {
  const { client, isConnecting, error } = useAppsContext<T>();

  if (error) {
    throw error;
  }

  if (isConnecting || !client) {
    throw new Error(
      'Client not ready. Make sure AppsProvider has finished connecting.',
    );
  }

  return client;
}

/**
 * Access current tool result with automatic re-renders
 *
 * @returns Current tool result or undefined
 *
 * @example
 * ```tsx
 * function ResultDisplay() {
 *   const result = useToolResult<typeof app.tools>();
 *
 *   if (!result?.myTool) {
 *     return <div>No results yet</div>;
 *   }
 *
 *   return <div>{result.myTool.message}</div>;
 * }
 * ```
 */
export function useToolResult<T extends ToolDefs = ToolDefs>():
  | ToolResult<T>
  | undefined {
  const { client } = useAppsContext<T>();
  const [result, setResult] = useState<ToolResult<T> | undefined>(undefined);

  useEffect(() => {
    if (!client) {
      return;
    }

    // Get initial tool output if available (wrapped with tool name)
    const initialOutput = client.toolOutput;
    if (initialOutput && Object.keys(initialOutput).length > 0) {
      setResult(initialOutput as ToolResult<T>);
    }

    // Subscribe to future tool result updates
    const unsubscribe = client.onToolResult((newResult) => {
      setResult(newResult as ToolResult<T>);
    });

    return unsubscribe;
  }, [client]);

  return result;
}

/**
 * Access current tool input
 *
 * @returns Current tool input or undefined
 *
 * @example
 * ```tsx
 * function InputDisplay() {
 *   const input = useToolInput();
 *   return <pre>{JSON.stringify(input, null, 2)}</pre>;
 * }
 * ```
 */
export function useToolInput(): Record<string, unknown> | undefined {
  const { client } = useAppsContext();
  const [input, setInput] = useState<Record<string, unknown> | undefined>(
    client?.toolInput,
  );

  useEffect(() => {
    if (!client) return;

    const unsubscribe = client.onToolInput((newInput) => {
      setInput(newInput);
    });

    return unsubscribe;
  }, [client]);

  return input;
}

/**
 * Access host context with automatic re-renders on changes
 *
 * @returns Current host context
 *
 * @example
 * ```tsx
 * function ThemedComponent() {
 *   const context = useHostContext();
 *
 *   return (
 *     <div className={context.theme}>
 *       Display: {context.displayMode}
 *     </div>
 *   );
 * }
 * ```
 */
export function useHostContext(): HostContext {
  const { client } = useAppsContext();
  const [context, setContext] = useState<HostContext>(
    client?.hostContext ?? DEFAULT_HOST_CONTEXT,
  );

  useEffect(() => {
    if (!client) return;

    setContext(client.hostContext);
    return client.onHostContextChange(setContext);
  }, [client]);

  return context;
}

/**
 * Persisted widget state with automatic sync
 *
 * Works like useState but persists across widget reloads.
 * State persistence depends on host support.
 *
 * @param defaultValue - Initial state value
 * @returns [state, setState] tuple
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const [count, setCount] = useWidgetState(0);
 *
 *   return (
 *     <button onClick={() => setCount(c => c + 1)}>
 *       Count: {count}
 *     </button>
 *   );
 * }
 * ```
 */
export function useWidgetState<S>(
  defaultValue: S,
): [S, (newState: S | ((prev: S) => S)) => void] {
  const { client } = useAppsContext();

  const [state, setStateInternal] = useState<S>(() => {
    if (!client) return defaultValue;
    const stored = client.getState<S>();
    return stored ?? defaultValue;
  });

  const setState = useCallback(
    (newState: S | ((prev: S) => S)) => {
      setStateInternal((prev) => {
        const next =
          typeof newState === 'function'
            ? (newState as (prev: S) => S)(prev)
            : newState;

        // Persist to client (silent no-op on MCP Apps)
        client?.setState(next);

        return next;
      });
    },
    [client],
  );

  return [state, setState];
}

// =============================================================================
// MODEL CONTEXT HOOKS
// =============================================================================

/**
 * Hook to update the host's model context
 *
 * Unlike sendMessage which triggers follow-up actions, context updates
 * inform the model about app state without triggering responses.
 *
 * Platform implementation details:
 * - MCP Apps: Uses native protocol feature for pure context updates
 *
 * @returns Function to update model context
 *
 * @example
 * ```tsx
 * function ShoppingCart({ items }) {
 *   const updateContext = useUpdateModelContext();
 *
 *   // Keep the model informed about cart state
 *   useEffect(() => {
 *     updateContext({
 *       structuredContent: {
 *         itemCount: items.length,
 *         total: calculateTotal(items),
 *         currency: "USD"
 *       }
 *     });
 *   }, [items, updateContext]);
 *
 *   return <CartUI items={items} />;
 * }
 * ```
 */
export function useUpdateModelContext(): (
  params: UpdateModelContextParams,
) => Promise<void> {
  const { client } = useAppsContext();

  return useCallback(
    async (params: UpdateModelContextParams) => {
      if (!client) {
         
        console.warn('[useUpdateModelContext] Client not available');
        return;
      }
      await client.updateModelContext(params);
    },
    [client],
  );
}

// =============================================================================
// UTILITY HOOKS
// =============================================================================

/**
 * Apply host CSS variables to document root
 *
 * Call this once in your root component to apply host theming.
 *
 * @example
 * ```tsx
 * function App() {
 *   useHostStyleVariables();
 *   return <MyWidget />;
 * }
 * ```
 */
export function useHostStyleVariables(): void {
  const context = useHostContext();

  useEffect(() => {
    const variables = context.styles?.variables;
    if (!variables) return;

    const root = document.documentElement;
    for (const [key, value] of Object.entries(variables)) {
      root.style.setProperty(key, value);
    }

    // Cleanup
    return () => {
      for (const key of Object.keys(variables)) {
        root.style.removeProperty(key);
      }
    };
  }, [context.styles?.variables]);
}

/**
 * Apply theme class to document body
 *
 * @param lightClass - Class name for light theme (default: "light")
 * @param darkClass - Class name for dark theme (default: "dark")
 *
 * @example
 * ```tsx
 * function App() {
 *   useDocumentTheme("theme-light", "theme-dark");
 *   return <MyWidget />;
 * }
 * ```
 */
export function useDocumentTheme(
  lightClass = 'light',
  darkClass = 'dark',
): void {
  const context = useHostContext();

  useEffect(() => {
    const { theme } = context;
    const body = document.body;

    body.classList.remove(lightClass, darkClass);
    body.classList.add(theme === 'dark' ? darkClass : lightClass);

    return () => {
      body.classList.remove(lightClass, darkClass);
    };
  }, [context.theme, lightClass, darkClass]);
}

/**
 * Access and manage display mode
 *
 * @returns Display mode state and controls
 *
 * @example
 * ```tsx
 * function DisplayModeToggle() {
 *   const { mode, availableModes, requestMode } = useDisplayMode();
 *
 *   return (
 *     <select value={mode} onChange={e => requestMode(e.target.value)}>
 *       {availableModes.map(m => (
 *         <option key={m} value={m}>{m}</option>
 *       ))}
 *     </select>
 *   );
 * }
 * ```
 */
export function useDisplayMode(): {
  mode: string;
  availableModes: string[];
  requestMode: (mode: 'inline' | 'fullscreen' | 'pip') => Promise<void>;
} {
  const context = useHostContext();
  const { client } = useAppsContext();

  const requestMode = useCallback(
    async (mode: 'inline' | 'fullscreen' | 'pip') => {
      await client?.requestDisplayMode(mode);
    },
    [client],
  );

  return {
    mode: context.displayMode,
    availableModes: context.availableDisplayModes,
    requestMode,
  };
}

/**
 * Access safe area insets for mobile layouts
 *
 * @returns Safe area insets or default zeros
 *
 * @example
 * ```tsx
 * function SafeContent() {
 *   const insets = useSafeAreaInsets();
 *
 *   return (
 *     <div style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
 *       Content
 *     </div>
 *   );
 * }
 * ```
 */
export function useSafeAreaInsets(): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const context = useHostContext();
  return context.safeAreaInsets ?? DEFAULT_INSETS;
}

// =============================================================================
// EVENT HOOKS
// =============================================================================

/**
 * Subscribe to tool cancellation
 *
 * @param handler - Callback when tool is cancelled
 *
 * @example
 * ```tsx
 * function CancellableOperation() {
 *   const [cancelled, setCancelled] = useState(false);
 *
 *   useOnToolCancelled((reason) => {
 *     setCancelled(true);
 *     console.log("Cancelled:", reason);
 *   });
 *
 *   return cancelled ? <div>Cancelled</div> : <div>Running...</div>;
 * }
 * ```
 */
export function useOnToolCancelled(handler: (reason?: string) => void): void {
  const { client } = useAppsContext();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!client) return;
    return client.onToolCancelled((reason) => handlerRef.current(reason));
  }, [client]);
}

/**
 * Subscribe to teardown events
 *
 * @param handler - Callback when widget is torn down
 *
 * @example
 * ```tsx
 * function CleanupComponent() {
 *   useOnTeardown((reason) => {
 *     console.log("Tearing down:", reason);
 *     // Cleanup resources
 *   });
 *
 *   return <div>Widget</div>;
 * }
 * ```
 */
export function useOnTeardown(handler: (reason?: string) => void): void {
  const { client } = useAppsContext();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!client) return;
    return client.onTeardown((reason) => handlerRef.current(reason));
  }, [client]);
}

/**
 * Subscribe to partial/streaming tool input
 *
 * Called when the host sends partial tool arguments during streaming.
 * Useful for showing real-time input as the user types or as the model generates.
 *
 * @param handler - Callback for partial input
 *
 * @example
 * ```tsx
 * function StreamingInput() {
 *   const [partialInput, setPartialInput] = useState<Record<string, unknown>>({});
 *
 *   useOnToolInputPartial((input) => {
 *     setPartialInput(input);
 *   });
 *
 *   return <pre>{JSON.stringify(partialInput, null, 2)}</pre>;
 * }
 * ```
 */
export function useOnToolInputPartial(
  handler: (input: Record<string, unknown>) => void,
): void {
  const { client } = useAppsContext();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!client) return;
    return client.onToolInputPartial((input) => handlerRef.current(input));
  }, [client]);
}

// =============================================================================
// HOST INFORMATION HOOKS
// =============================================================================

/**
 * Access host capabilities
 *
 * Returns the capabilities advertised by the host during handshake.
 * Use this to check if features like logging or server tools are supported.
 *
 * @returns Host capabilities or undefined if not yet connected
 *
 * @example
 * ```tsx
 * function CapabilitiesDisplay() {
 *   const capabilities = useHostCapabilities();
 *
 *   return (
 *     <div>
 *       <p>Logging: {capabilities?.logging ? "Supported" : "Not supported"}</p>
 *       <p>Open Links: {capabilities?.openLinks ? "Supported" : "Not supported"}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useHostCapabilities(): HostCapabilities | undefined {
  const { client } = useAppsContext();
  const [capabilities, setCapabilities] = useState<
    HostCapabilities | undefined
  >(client?.getHostCapabilities());

  useEffect(() => {
    if (!client) {
      setCapabilities(undefined);
      return;
    }

    setCapabilities(client.getHostCapabilities());
    return client.onHostContextChange(() =>
      setCapabilities(client.getHostCapabilities()),
    );
  }, [client]);

  return capabilities;
}

/**
 * Access host version information
 *
 * Returns the name and version of the host application.
 *
 * @returns Host version info or undefined if not yet connected
 *
 * @example
 * ```tsx
 * function HostInfo() {
 *   const hostVersion = useHostVersion();
 *
 *   if (!hostVersion) return <div>Loading...</div>;
 *
 *   return (
 *     <div>
 *       Running on {hostVersion.name} v{hostVersion.version}
 *     </div>
 *   );
 * }
 * ```
 */
export function useHostVersion(): HostVersion | undefined {
  const { client } = useAppsContext();
  const [version, setVersion] = useState<HostVersion | undefined>(() =>
    client?.getHostVersion(),
  );

  useEffect(() => {
    if (!client) {
      setVersion(undefined);
      return;
    }

    // Update version when client changes
    setVersion(client.getHostVersion());
  }, [client]);

  return version;
}

// =============================================================================
// SIZE NOTIFICATION HOOKS
// =============================================================================

/**
 * Subscribe to the resource `_meta` envelope surfaced by the host.
 *
 * Carries host-signed claims like `_meta.license` (iframe gate) and
 * `_meta.ui.csp` (sandbox policy). Updates whenever the host pushes a
 * new envelope (initial mount, resource refresh, tool-result `_meta`,
 * or host-context update).
 *
 * @returns Resource meta envelope, or `undefined` until first surfaced.
 *
 * @example
 * ```tsx
 * function LicenseGate({ children }) {
 *   const meta = useResourceMeta();
 *   const token = meta?.license?.token as string | undefined;
 *   // verify + branch on outcome ...
 * }
 * ```
 */
export function useResourceMeta(): Record<string, unknown> | undefined {
  const { client } = useAppsContext();
  const [meta, setMeta] = useState<Record<string, unknown> | undefined>(
    () => client?.resourceMeta,
  );

  useEffect(() => {
    if (!client) {
      setMeta(undefined);
      return;
    }
    setMeta(client.resourceMeta);
    return client.onResourceMetaChange((next) => setMeta(next));
  }, [client]);

  return meta;
}

/**
 * Hook to set up automatic size change notifications
 *
 * Creates a ResizeObserver that automatically sends size changed
 * notifications to the host when the observed element resizes.
 *
 * @returns Ref to attach to the element to observe
 *
 * @example
 * ```tsx
 * function AutoSizeWidget() {
 *   const containerRef = useSizeChangedNotifications();
 *
 *   return (
 *     <div ref={containerRef}>
 *       <p>Content that may change size...</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useSizeChangedNotifications(): RefObject<HTMLElement | null> {
  const { client } = useAppsContext();
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!client || !element || typeof ResizeObserver === 'undefined') return;

    const observer = createSizeObserver(element, (width, height) => {
      void client.sendSizeChanged({ width, height });
    });

    return () => observer.disconnect();
  }, [client]);

  return containerRef;
}

// =============================================================================
// DEBUG LOGGING HOOKS
// =============================================================================

/**
 * Access the debug logger with automatic adapter injection
 *
 * The adapter is automatically configured when AppsProvider connects.
 * Use this hook to access the logger and optionally configure it.
 *
 * @param config - Optional configuration to apply
 * @returns The configured client debug logger
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const logger = useDebugLogger({ enabled: true, level: "debug" });
 *
 *   const handleClick = () => {
 *     logger.info("Button clicked", { timestamp: Date.now() });
 *   };
 *
 *   return <button onClick={handleClick}>Click me</button>;
 * }
 * ```
 */
export function useDebugLogger(
  config?: Partial<ClientDebugConfig>,
): ClientDebugLogger {
  // Verify we're inside AppsProvider (adapter is set by createClient)
  useAppsContext();

  // Apply configuration when it changes
  useEffect(() => {
    if (config) {
      clientDebugLogger.configure(config);
    }
  }, [config]);

  return clientDebugLogger;
}

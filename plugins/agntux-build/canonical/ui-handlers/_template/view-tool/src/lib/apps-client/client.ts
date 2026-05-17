/**
 * Unified MCP Apps client for UI code
 *
 * Inlined from @mcp-apps-kit/ui v0.5.0
 * Source: https://github.com/agntux/mcp-apps-kit
 * Date: 2026-01-24
 *
 * Factory for creating protocol-appropriate AppsClient instances.
 *
 * @module client
 */

import { McpAdapter } from './adapters/mcp.js';
import { MockAdapter } from './adapters/mock.js';
import type { ProtocolAdapter } from './adapters/types.js';
import { detectProtocol } from './detection.js';
import { clientDebugLogger } from './debug/logger.js';
import type {
  AppsClient,
  HostContext,
  ResourceContent,
  ToolDefs,
  InferToolInputs,
  InferToolOutputs,
  ToolResult,
  ToolMethods,
  HostCapabilities,
  HostVersion,
  SizeChangedParams,
  CallToolHandler,
  ListToolsHandler,
  CreateClientOptions,
  UpdateModelContextParams,
} from './types.js';

// =============================================================================
// CLIENT IMPLEMENTATION
// =============================================================================

/**
 * Internal client implementation that wraps the protocol adapter
 *
 * Provides the unified AppsClient interface regardless of which
 * protocol the host uses.
 *
 * @internal
 */
class AppsClientImpl<T extends ToolDefs = ToolDefs> implements AppsClient<T> {
  private readonly adapter: ProtocolAdapter;
  private readonly _tools: ToolMethods<T>;

  constructor(adapter: ProtocolAdapter) {
    this.adapter = adapter;
    // Create a proxy that dynamically calls tools
    this._tools = new Proxy({} as ToolMethods<T>, {
      get: (_target, prop: string) => {
        // Convert callToolName to toolName (e.g., callGreet -> greet)
        if (prop.startsWith('call') && prop.length > 4) {
          const toolName = prop.charAt(4).toLowerCase() + prop.slice(5);
          return async (args: unknown) => {
            return this.callTool(
              toolName as keyof T,
              args as InferToolInputs<T>[keyof T],
            );
          };
        }
        return undefined;
      },
    });
  }

  // === Tool Operations ===

  async callTool<K extends keyof T>(
    name: K,
    args: InferToolInputs<T>[K],
  ): Promise<InferToolOutputs<T>[K]> {
    const result = await this.adapter.callTool(
      String(name),
      args as Record<string, unknown>,
    );
    return result as InferToolOutputs<T>[K];
  }

  get tools(): ToolMethods<T> {
    return this._tools;
  }

  // === Messaging ===

  async sendMessage(content: { type: 'text'; text: string }): Promise<void> {
    await this.adapter.sendMessage(content);
  }

  async sendFollowUpMessage(prompt: string): Promise<void> {
    await this.sendMessage({ type: 'text', text: prompt });
  }

  // === Model Context ===

  async updateModelContext(params: UpdateModelContextParams): Promise<void> {
    await this.adapter.updateModelContext(params);
  }

  // === Navigation ===

  async openLink(url: string): Promise<void> {
    await this.adapter.openLink(url);
  }

  async requestDisplayMode(
    mode: 'inline' | 'fullscreen' | 'pip',
  ): Promise<{ mode: string }> {
    return this.adapter.requestDisplayMode(mode);
  }

  requestClose(): void {
    this.adapter.requestClose();
  }

  // === State ===

  getState<S>(): S | null {
    return this.adapter.getState<S>();
  }

  setState<S>(state: S): void {
    this.adapter.setState(state);
  }

  // === Resources ===

  async readResource(uri: string): Promise<{ contents: ResourceContent[] }> {
    return this.adapter.readResource(uri);
  }

  // === Logging ===

  log(level: 'debug' | 'info' | 'warning' | 'error', data: unknown): void {
    this.adapter.log(level, data);
  }

  // === Events ===

  onToolResult(handler: (result: ToolResult<T>) => void): () => void {
    return this.adapter.onToolResult(handler as (result: unknown) => void);
  }

  onToolInput(handler: (input: Record<string, unknown>) => void): () => void {
    return this.adapter.onToolInput(handler as (input: unknown) => void);
  }

  onToolCancelled(handler: (reason?: string) => void): () => void {
    return this.adapter.onToolCancelled(handler);
  }

  onHostContextChange(handler: (context: HostContext) => void): () => void {
    return this.adapter.onHostContextChange(handler);
  }

  onTeardown(handler: (reason?: string) => void): () => void {
    return this.adapter.onTeardown(handler);
  }

  onToolInputPartial(
    handler: (input: Record<string, unknown>) => void,
  ): () => void {
    return this.adapter.onToolInputPartial(handler as (input: unknown) => void);
  }

  // === Host Information ===

  getHostCapabilities(): HostCapabilities | undefined {
    return this.adapter.getHostCapabilities();
  }

  getHostVersion(): HostVersion | undefined {
    return this.adapter.getHostVersion();
  }

  // === Protocol-Level Logging ===

  async sendLog(
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
  ): Promise<void> {
    await this.adapter.sendLog(level, data);
  }

  // === Size Notifications ===

  async sendSizeChanged(params: SizeChangedParams): Promise<void> {
    await this.adapter.sendSizeChanged(params);
  }

  /**
   * Set up automatic size change notifications
   *
   * Creates a ResizeObserver that automatically sends size changed
   * notifications to the host when the document body or documentElement resizes.
   *
   * This is useful for MCP Apps to auto-report their size without manual tracking.
   *
   * @returns Cleanup function to stop observing
   */
  setupSizeChangedNotifications(): () => void {
    if (
      typeof window === 'undefined' ||
      typeof ResizeObserver === 'undefined'
    ) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return () => {};
    }

    let lastWidth = 0;
    let lastHeight = 0;

    const sendIfChanged = (width: number, height: number) => {
      const w = Math.round(width);
      const h = Math.round(height);

      if (w !== lastWidth || h !== lastHeight) {
        lastWidth = w;
        lastHeight = h;
        void this.sendSizeChanged({ width: w, height: h });
      }
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sendIfChanged(width, height);
      }
    });

    // Observe both body and documentElement
    if (document.body) {
      observer.observe(document.body);
    }
    if (document.documentElement) {
      observer.observe(document.documentElement);
    }

    // Send initial size
    const rect = document.body?.getBoundingClientRect() ?? {
      width: 800,
      height: 600,
    };
    sendIfChanged(rect.width, rect.height);

    return () => observer.disconnect();
  }

  // === Bidirectional Tool Support ===

  setCallToolHandler(handler: CallToolHandler): void {
    this.adapter.setCallToolHandler(handler);
  }

  setListToolsHandler(handler: ListToolsHandler): void {
    this.adapter.setListToolsHandler(handler);
  }

  // === Current State (Read-Only) ===

  get hostContext(): HostContext {
    return this.adapter.getHostContext();
  }

  get toolInput(): Record<string, unknown> | undefined {
    return this.adapter.getToolInput();
  }

  get toolOutput(): Record<string, unknown> | undefined {
    return this.adapter.getToolOutput();
  }

  get toolMeta(): Record<string, unknown> | undefined {
    return this.adapter.getToolMeta();
  }

  // === Resource Meta ===

  get resourceMeta(): Record<string, unknown> | undefined {
    return this.adapter.getResourceMeta();
  }

  onResourceMetaChange(
    handler: (meta: Record<string, unknown> | undefined) => void,
  ): () => void {
    return this.adapter.onResourceMetaChange(handler);
  }

  // === Generic Notifications ===

  async sendNotification(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    await this.adapter.sendNotification(method, params);
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new AppsClient instance
 *
 * Automatically detects the host protocol and creates the appropriate
 * adapter. Returns a connected client ready
 * for use.
 *
 * @param options - Client creation options
 * @returns Connected AppsClient instance
 *
 * @example
 * ```typescript
 * // Basic usage with auto-detection
 * const client = await createClient();
 *
 * // Force a specific adapter (useful for testing)
 * const mockClient = await createClient({ forceAdapter: "mock" });
 *
 * // With typed tools
 * const typedClient = await createClient<typeof myApp.tools>();
 * ```
 */
export async function createClient<T extends ToolDefs = ToolDefs>(
  options: CreateClientOptions = {},
): Promise<AppsClient<T>> {
  // Determine which adapter to use
  const protocol = options.forceAdapter ?? detectProtocol();

  let adapter: ProtocolAdapter;

  switch (protocol) {
    case 'mcp':
      adapter = new McpAdapter({ autoResize: options.autoResize });
      break;
    case 'mock':
    default:
      adapter = new MockAdapter();
      break;
  }

  // Connect the adapter
  await adapter.connect();

  // Set up the debug logger with the connected adapter
  clientDebugLogger.setAdapter(adapter);

  // Create the client wrapper
  const client = new AppsClientImpl<T>(adapter);

  return client;
}

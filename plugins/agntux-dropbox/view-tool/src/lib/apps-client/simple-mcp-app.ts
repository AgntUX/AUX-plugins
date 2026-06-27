/**
 * Minimal MCP Apps postMessage protocol implementation.
 *
 * Replaces @modelcontextprotocol/ext-apps with a zero-dependency,
 * CSP-compliant implementation of the JSON-RPC 2.0 over postMessage
 * protocol used by MCP Apps hosts.
 *
 * Provides the same API surface that McpAdapter consumes from the
 * ext-apps `App` class, without pulling in the full SDK dependency
 * tree (which triggers CSP violations in some host environments).
 *
 * @internal
 */

import { LATEST_PROTOCOL_VERSION } from './constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** App/host identification (matches MCP SDK Implementation) */
interface Implementation {
  name: string;
  version: string;
}

/** JSON-RPC 2.0 error object */
interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** Pending request tracker */
interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Default timeout for JSON-RPC requests (ms). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// SimpleMcpApp
// ---------------------------------------------------------------------------

export class SimpleMcpApp {
  private _nextId = 1;
  private _pending = new Map<number, PendingRequest>();
  private _hostCapabilities?: Record<string, unknown>;
  private _hostContext?: Record<string, unknown>;
  private _hostInfo?: Implementation;
  private _listener?: (event: MessageEvent) => void;
  private _resizeCleanup?: () => void;
  private _connected = false;

  private readonly _appInfo: Implementation;
  private readonly _capabilities: Record<string, unknown>;
  private readonly _autoResize: boolean;

  // --- Notification handler setters (host → app) ---
  onerror?: (error: Error) => void;
  onhostcontextchanged?: (params: unknown) => void;
  ontoolinput?: (params: unknown) => void;
  ontoolinputpartial?: (params: unknown) => void;
  ontoolresult?: (params: unknown) => void;
  ontoolcancelled?: (params: unknown) => void;

  // --- Request handler setters (host → app, must return result) ---
  onteardown?: (params: unknown) => unknown | Promise<unknown>;
  oncalltool?: (params: unknown) => Promise<unknown>;
  onlisttools?: () => Promise<unknown>;

  constructor(
    appInfo: Implementation,
    capabilities?: Record<string, unknown>,
    options?: { autoResize?: boolean },
  ) {
    this._appInfo = appInfo;
    this._capabilities = capabilities ?? {};
    this._autoResize = options?.autoResize ?? true;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Connect to the host via postMessage and perform the initialization
   * handshake (ui/initialize → response → ui/notifications/initialized).
   */
  async connect(): Promise<void> {
    if (this._connected) return;

    // SSR / test guard: behave as connected but inert.
    if (typeof window === 'undefined') {
      this._connected = true;
      return;
    }

    // Install the postMessage listener.
    this._listener = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      // Verbose host-message log gated behind a window flag — useful during
      // initial-fix diagnosis (9.5.4 / 9.5.5), spammy in production. Set
      // `window.__MCP_APPS_DEBUG__ = true` from the iframe entry to enable.
      if ((window as unknown as { __MCP_APPS_DEBUG__?: boolean }).__MCP_APPS_DEBUG__) {
        console.log('[SimpleMcpApp] incoming message:', event.data);
      }

      const data: unknown = event.data;
      if (
        !data ||
        typeof data !== 'object' ||
        (data as Record<string, unknown>).jsonrpc !== '2.0'
      ) {
        return;
      }
      this._handleMessage(data as Record<string, unknown>);
    };
    window.addEventListener('message', this._listener);

    // Perform the initialization handshake.
    const result = (await this._sendRequest('ui/initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      appInfo: this._appInfo,
      appCapabilities: this._capabilities,
      // Backward-compat aliases for older hosts
      clientInfo: this._appInfo,
      capabilities: this._capabilities,
    })) as Record<string, unknown> | undefined;

    if (result && typeof result === 'object') {
      this._hostCapabilities = (result.hostCapabilities ??
        result.capabilities) as Record<string, unknown> | undefined;
      this._hostContext = result.hostContext as
        | Record<string, unknown>
        | undefined;
      const hostInfo = (result.hostInfo ?? result.serverInfo) as
        | Record<string, unknown>
        | undefined;
      if (hostInfo) {
        this._hostInfo = {
          name: String(hostInfo.name ?? ''),
          version: String(hostInfo.version ?? ''),
        };
      }
    }

    // Notify the host that initialization is complete.
    this._sendNotification('ui/notifications/initialized', {});

    // Enable automatic size reporting if requested.
    if (this._autoResize) {
      this._resizeCleanup = this.setupSizeChangedNotifications();
    }

    this._connected = true;
  }

  /**
   * Disconnect from the host, remove the postMessage listener, cancel the
   * ResizeObserver, and reject any in-flight requests.
   */
  close(): void {
    if (this._listener) {
      window.removeEventListener('message', this._listener);
      this._listener = undefined;
    }

    this._resizeCleanup?.();
    this._resizeCleanup = undefined;

    // Reject all pending requests so callers aren't left hanging.
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed'));
      this._pending.delete(id);
    }

    this._connected = false;
  }

  // ==========================================================================
  // Accessors
  // ==========================================================================

  getHostContext(): Record<string, unknown> | undefined {
    return this._hostContext;
  }

  getHostCapabilities(): Record<string, unknown> | undefined {
    return this._hostCapabilities;
  }

  getHostVersion(): Implementation | undefined {
    return this._hostInfo;
  }

  // ==========================================================================
  // Outbound requests (app → host)
  // ==========================================================================

  async callServerTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown> {
    return this._sendRequest('tools/call', params as Record<string, unknown>);
  }

  async sendMessage(params: {
    role: string;
    content: unknown[];
  }): Promise<unknown> {
    return this._sendRequest('ui/message', params as Record<string, unknown>);
  }

  async updateModelContext(params: {
    content?: unknown[];
    structuredContent?: Record<string, unknown>;
  }): Promise<unknown> {
    return this._sendRequest(
      'ui/update-model-context',
      params as Record<string, unknown>,
    );
  }

  async openLink(params: { url: string }): Promise<unknown> {
    return this._sendRequest('ui/open-link', params as Record<string, unknown>);
  }

  async requestDisplayMode(params: {
    mode: string;
  }): Promise<{ mode: 'inline' | 'fullscreen' | 'pip'; [k: string]: unknown }> {
    return (await this._sendRequest(
      'ui/request-display-mode',
      params as Record<string, unknown>,
    )) as { mode: 'inline' | 'fullscreen' | 'pip'; [k: string]: unknown };
  }

  /**
   * Generic JSON-RPC request (used by adapter for resources/read, etc.).
   *
   * Accepts a schema parameter for API compatibility with ext-apps but
   * does not perform runtime validation.
   */
  async request(
    req: { method: string; params?: Record<string, unknown> },
    _schema?: unknown,
  ): Promise<unknown> {
    return this._sendRequest(req.method, req.params);
  }

  // ==========================================================================
  // Outbound notifications (app → host, fire-and-forget)
  // ==========================================================================

  async sendLog(params: {
    level: string;
    data: unknown;
    logger?: string;
  }): Promise<void> {
    this._sendNotification(
      'notifications/message',
      params as Record<string, unknown>,
    );
  }

  async sendSizeChanged(params: {
    width: number;
    height: number;
  }): Promise<void> {
    this._sendNotification(
      'ui/notifications/size-changed',
      params as Record<string, unknown>,
    );
  }

  /**
   * Generic outbound notification — exposes `_sendNotification` for
   * protocol-level features like the iframe license gate that need a
   * one-way channel to the host (e.g., `ui/notifications/license-failed`).
   */
  notify(method: string, params?: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    this._sendNotification(method, params);
  }

  // ==========================================================================
  // Auto-resize
  // ==========================================================================

  /**
   * Set up a ResizeObserver on the document root elements and automatically
   * send `ui/notifications/size-changed` to the host.
   *
   * @returns cleanup function that disconnects the observer
   */
  setupSizeChangedNotifications(): () => void {
    if (typeof document === 'undefined') {
      return () => {};
    }

    // Emit one initial size signal synchronously, before the first
    // ResizeObserver callback fires (and even when ResizeObserver isn't
    // available at all — e.g. strict-CSP hosts or older browsers).
    // Without this, the host's iframe-size decision is made off whatever
    // default it picked (typically 200-400 pixels) and many hosts only
    // honor the *initial* size — later notifications are ignored.
    // Reporting up-front lets the host commit to a useful height on
    // first paint. The observer below (when available) still picks up
    // every subsequent change.
    const initialWidth =
      document.documentElement.scrollWidth ||
      (typeof window !== 'undefined' ? window.innerWidth : 800);
    const initialHeight =
      document.documentElement.scrollHeight ||
      (typeof window !== 'undefined' ? window.innerHeight : 600);
    void this.sendSizeChanged({ width: initialWidth, height: initialHeight });

    if (typeof ResizeObserver === 'undefined') {
      // No observer means no later updates, but the initial emit still
      // gave the host a useful starting point. Return no-op cleanup.
      return () => {};
    }

    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const width = document.documentElement.scrollWidth;
        const height = document.documentElement.scrollHeight;
        void this.sendSizeChanged({ width, height });
      });
    });

    observer.observe(document.documentElement);
    if (document.body) {
      observer.observe(document.body);
    }

    return () => {
      observer.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }

  // ==========================================================================
  // Internal – postMessage transport
  //
  // Security note: outbound messages use '*' as the target origin because the
  // iframe does not know its parent's origin at startup. This matches the
  // behaviour of the upstream ext-apps PostMessageTransport. Inbound messages
  // are validated by checking `event.source === window.parent`, which prevents
  // messages from sibling iframes or the app's own window.
  // ==========================================================================

  private _sendRequest(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = this._nextId++;

      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(
          new Error(
            `JSON-RPC request "${method}" timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this._pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });

      window.parent.postMessage(
        {
          jsonrpc: '2.0',
          id,
          method,
          ...(params !== undefined && { params }),
        },
        '*',
      );
    });
  }

  private _sendNotification(
    method: string,
    params?: Record<string, unknown>,
  ): void {
    window.parent.postMessage(
      {
        jsonrpc: '2.0',
        method,
        ...(params !== undefined && { params }),
      },
      '*',
    );
  }

  // ==========================================================================
  // Internal – message dispatch
  // ==========================================================================

  private _handleMessage(msg: Record<string, unknown>): void {
    const hasMethod = typeof msg.method === 'string';
    const hasId = msg.id !== undefined && msg.id !== null;

    if (!hasMethod && hasId) {
      // Response to one of our outbound requests.
      this._handleResponse(msg);
      return;
    }

    if (hasMethod && hasId) {
      // Incoming request from host (needs a response).
      void this._handleIncomingRequest(msg);
      return;
    }

    if (hasMethod && !hasId) {
      // Notification from host (fire-and-forget).
      this._handleNotification(msg);
    }
  }

  private _handleResponse(msg: Record<string, unknown>): void {
    const id = msg.id as number;
    const pending = this._pending.get(id);
    if (!pending) return;
    this._pending.delete(id);

    const error = msg.error as JsonRpcError | undefined;
    if (error) {
      pending.reject(new Error(error.message ?? 'JSON-RPC error'));
    } else {
      pending.resolve(msg.result);
    }
  }

  private _handleNotification(msg: Record<string, unknown>): void {
    const method = msg.method as string;
    const params = msg.params as Record<string, unknown> | undefined;

    try {
      switch (method) {
        case 'ui/notifications/tool-input':
          this.ontoolinput?.(params);
          break;
        case 'ui/notifications/tool-input-partial':
          this.ontoolinputpartial?.(params);
          break;
        case 'ui/notifications/tool-result':
          this.ontoolresult?.(params);
          break;
        case 'ui/notifications/tool-cancelled':
          this.ontoolcancelled?.(params);
          break;
        case 'ui/notifications/host-context-changed': {
          // Merge updated context before invoking the callback so that
          // getHostContext() already returns fresh data inside the handler.
          if (params && typeof params === 'object') {
            const nested = (params as { hostContext?: unknown }).hostContext;
            const updates =
              nested && typeof nested === 'object'
                ? (nested as Record<string, unknown>)
                : params;
            this._hostContext = { ...this._hostContext, ...updates };
          }
          this.onhostcontextchanged?.(params);
          break;
        }
        default:
          break;
      }
    } catch (err) {
      this.onerror?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async _handleIncomingRequest(
    msg: Record<string, unknown>,
  ): Promise<void> {
    const id = msg.id as number;
    const method = msg.method as string;
    const params = msg.params as Record<string, unknown> | undefined;

    try {
      let result: unknown;
      switch (method) {
        case 'ui/resource-teardown':
        case 'ui/teardown':
          result = this.onteardown ? await this.onteardown(params) : {};
          break;
        case 'tools/call':
          result = this.oncalltool
            ? await this.oncalltool(params)
            : {
                content: [{ type: 'text', text: 'No handler registered' }],
                isError: true,
              };
          break;
        case 'tools/list':
          result = this.onlisttools ? await this.onlisttools() : { tools: [] };
          break;
        case 'prompts/list':
          result = { prompts: [] };
          break;
        default:
          this._sendJsonRpcResponse(id, undefined, {
            code: -32601,
            message: `Method not found: ${method}`,
          });
          return;
      }
      this._sendJsonRpcResponse(id, result);
    } catch (err) {
      this._sendJsonRpcResponse(id, undefined, {
        code: -32603,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private _sendJsonRpcResponse(
    id: number,
    result?: unknown,
    error?: JsonRpcError,
  ): void {
    window.parent.postMessage(
      {
        jsonrpc: '2.0',
        id,
        ...(error ? { error } : { result: result ?? {} }),
      },
      '*',
    );
  }
}

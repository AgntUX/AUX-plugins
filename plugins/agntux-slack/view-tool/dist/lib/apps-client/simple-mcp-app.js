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
/** Default timeout for JSON-RPC requests (ms). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
// ---------------------------------------------------------------------------
// SimpleMcpApp
// ---------------------------------------------------------------------------
export class SimpleMcpApp {
    _nextId = 1;
    _pending = new Map();
    _hostCapabilities;
    _hostContext;
    _hostInfo;
    _listener;
    _resizeCleanup;
    _connected = false;
    _appInfo;
    _capabilities;
    _autoResize;
    // --- Notification handler setters (host → app) ---
    onerror;
    onhostcontextchanged;
    ontoolinput;
    ontoolinputpartial;
    ontoolresult;
    ontoolcancelled;
    // --- Request handler setters (host → app, must return result) ---
    onteardown;
    oncalltool;
    onlisttools;
    constructor(appInfo, capabilities, options) {
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
    async connect() {
        if (this._connected)
            return;
        // SSR / test guard: behave as connected but inert.
        if (typeof window === 'undefined') {
            this._connected = true;
            return;
        }
        // Install the postMessage listener.
        this._listener = (event) => {
            if (event.source !== window.parent)
                return;
            // Verbose host-message log gated behind a window flag — useful during
            // initial-fix diagnosis (9.5.4 / 9.5.5), spammy in production. Set
            // `window.__MCP_APPS_DEBUG__ = true` from the iframe entry to enable.
            if (window.__MCP_APPS_DEBUG__) {
                console.log('[SimpleMcpApp] incoming message:', event.data);
            }
            const data = event.data;
            if (!data ||
                typeof data !== 'object' ||
                data.jsonrpc !== '2.0') {
                return;
            }
            this._handleMessage(data);
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
        }));
        if (result && typeof result === 'object') {
            this._hostCapabilities = (result.hostCapabilities ??
                result.capabilities);
            this._hostContext = result.hostContext;
            const hostInfo = (result.hostInfo ?? result.serverInfo);
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
    close() {
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
    getHostContext() {
        return this._hostContext;
    }
    getHostCapabilities() {
        return this._hostCapabilities;
    }
    getHostVersion() {
        return this._hostInfo;
    }
    // ==========================================================================
    // Outbound requests (app → host)
    // ==========================================================================
    async callServerTool(params) {
        return this._sendRequest('tools/call', params);
    }
    async sendMessage(params) {
        return this._sendRequest('ui/message', params);
    }
    async updateModelContext(params) {
        return this._sendRequest('ui/update-model-context', params);
    }
    async openLink(params) {
        return this._sendRequest('ui/open-link', params);
    }
    async requestDisplayMode(params) {
        return (await this._sendRequest('ui/request-display-mode', params));
    }
    /**
     * Generic JSON-RPC request (used by adapter for resources/read, etc.).
     *
     * Accepts a schema parameter for API compatibility with ext-apps but
     * does not perform runtime validation.
     */
    async request(req, _schema) {
        return this._sendRequest(req.method, req.params);
    }
    // ==========================================================================
    // Outbound notifications (app → host, fire-and-forget)
    // ==========================================================================
    async sendLog(params) {
        this._sendNotification('notifications/message', params);
    }
    async sendSizeChanged(params) {
        this._sendNotification('ui/notifications/size-changed', params);
    }
    /**
     * Generic outbound notification — exposes `_sendNotification` for
     * protocol-level features like the iframe license gate that need a
     * one-way channel to the host (e.g., `ui/notifications/license-failed`).
     */
    notify(method, params) {
        if (typeof window === 'undefined')
            return;
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
    setupSizeChangedNotifications() {
        if (typeof document === 'undefined' ||
            typeof ResizeObserver === 'undefined') {
            return () => { };
        }
        let rafId = null;
        const observer = new ResizeObserver(() => {
            if (rafId !== null)
                return;
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
    _sendRequest(method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`JSON-RPC request "${method}" timed out after ${timeoutMs}ms`));
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
            window.parent.postMessage({
                jsonrpc: '2.0',
                id,
                method,
                ...(params !== undefined && { params }),
            }, '*');
        });
    }
    _sendNotification(method, params) {
        window.parent.postMessage({
            jsonrpc: '2.0',
            method,
            ...(params !== undefined && { params }),
        }, '*');
    }
    // ==========================================================================
    // Internal – message dispatch
    // ==========================================================================
    _handleMessage(msg) {
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
    _handleResponse(msg) {
        const id = msg.id;
        const pending = this._pending.get(id);
        if (!pending)
            return;
        this._pending.delete(id);
        const error = msg.error;
        if (error) {
            pending.reject(new Error(error.message ?? 'JSON-RPC error'));
        }
        else {
            pending.resolve(msg.result);
        }
    }
    _handleNotification(msg) {
        const method = msg.method;
        const params = msg.params;
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
                        const nested = params.hostContext;
                        const updates = nested && typeof nested === 'object'
                            ? nested
                            : params;
                        this._hostContext = { ...this._hostContext, ...updates };
                    }
                    this.onhostcontextchanged?.(params);
                    break;
                }
                default:
                    break;
            }
        }
        catch (err) {
            this.onerror?.(err instanceof Error ? err : new Error(String(err)));
        }
    }
    async _handleIncomingRequest(msg) {
        const id = msg.id;
        const method = msg.method;
        const params = msg.params;
        try {
            let result;
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
        }
        catch (err) {
            this._sendJsonRpcResponse(id, undefined, {
                code: -32603,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    _sendJsonRpcResponse(id, result, error) {
        window.parent.postMessage({
            jsonrpc: '2.0',
            id,
            ...(error ? { error } : { result: result ?? {} }),
        }, '*');
    }
}
//# sourceMappingURL=simple-mcp-app.js.map
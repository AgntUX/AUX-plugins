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
/** App/host identification (matches MCP SDK Implementation) */
interface Implementation {
    name: string;
    version: string;
}
export declare class SimpleMcpApp {
    private _nextId;
    private _pending;
    private _hostCapabilities?;
    private _hostContext?;
    private _hostInfo?;
    private _listener?;
    private _resizeCleanup?;
    private _connected;
    private readonly _appInfo;
    private readonly _capabilities;
    private readonly _autoResize;
    onerror?: (error: Error) => void;
    onhostcontextchanged?: (params: unknown) => void;
    ontoolinput?: (params: unknown) => void;
    ontoolinputpartial?: (params: unknown) => void;
    ontoolresult?: (params: unknown) => void;
    ontoolcancelled?: (params: unknown) => void;
    onteardown?: (params: unknown) => unknown | Promise<unknown>;
    oncalltool?: (params: unknown) => Promise<unknown>;
    onlisttools?: () => Promise<unknown>;
    constructor(appInfo: Implementation, capabilities?: Record<string, unknown>, options?: {
        autoResize?: boolean;
    });
    /**
     * Connect to the host via postMessage and perform the initialization
     * handshake (ui/initialize → response → ui/notifications/initialized).
     */
    connect(): Promise<void>;
    /**
     * Disconnect from the host, remove the postMessage listener, cancel the
     * ResizeObserver, and reject any in-flight requests.
     */
    close(): void;
    getHostContext(): Record<string, unknown> | undefined;
    getHostCapabilities(): Record<string, unknown> | undefined;
    getHostVersion(): Implementation | undefined;
    callServerTool(params: {
        name: string;
        arguments?: Record<string, unknown>;
    }): Promise<unknown>;
    sendMessage(params: {
        role: string;
        content: unknown[];
    }): Promise<unknown>;
    updateModelContext(params: {
        content?: unknown[];
        structuredContent?: Record<string, unknown>;
    }): Promise<unknown>;
    openLink(params: {
        url: string;
    }): Promise<unknown>;
    requestDisplayMode(params: {
        mode: string;
    }): Promise<{
        mode: 'inline' | 'fullscreen' | 'pip';
        [k: string]: unknown;
    }>;
    /**
     * Generic JSON-RPC request (used by adapter for resources/read, etc.).
     *
     * Accepts a schema parameter for API compatibility with ext-apps but
     * does not perform runtime validation.
     */
    request(req: {
        method: string;
        params?: Record<string, unknown>;
    }, _schema?: unknown): Promise<unknown>;
    sendLog(params: {
        level: string;
        data: unknown;
        logger?: string;
    }): Promise<void>;
    sendSizeChanged(params: {
        width: number;
        height: number;
    }): Promise<void>;
    /**
     * Generic outbound notification — exposes `_sendNotification` for
     * protocol-level features like the iframe license gate that need a
     * one-way channel to the host (e.g., `ui/notifications/license-failed`).
     */
    notify(method: string, params?: Record<string, unknown>): void;
    /**
     * Set up a ResizeObserver on the document root elements and automatically
     * send `ui/notifications/size-changed` to the host.
     *
     * @returns cleanup function that disconnects the observer
     */
    setupSizeChangedNotifications(): () => void;
    private _sendRequest;
    private _sendNotification;
    private _handleMessage;
    private _handleResponse;
    private _handleNotification;
    private _handleIncomingRequest;
    private _sendJsonRpcResponse;
}
export {};
//# sourceMappingURL=simple-mcp-app.d.ts.map
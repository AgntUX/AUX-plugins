import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimpleMcpApp } from '../../lib/apps-client/simple-mcp-app.js';
import { LATEST_PROTOCOL_VERSION } from '../../lib/apps-client/constants.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Messages captured from postMessage calls. */
let sentMessages: Record<string, unknown>[];

/** Spy on window.parent.postMessage to capture outgoing messages. */
function installPostMessageSpy() {
  sentMessages = [];
  // In jsdom, window.parent === window.
  vi.spyOn(window.parent, 'postMessage').mockImplementation(
    (message: unknown, _targetOrigin: unknown) => {
      sentMessages.push(message as Record<string, unknown>);
    },
  );
}

/** Dispatch an incoming JSON-RPC message as if it came from the host. */
function receiveFromHost(data: Record<string, unknown>) {
  const event = new MessageEvent('message', {
    data,
    source: window.parent,
  });
  window.dispatchEvent(event);
}

/** Find the outgoing `ui/initialize` request and reply with a mock host response. */
function replyToInitialize(overrides?: Record<string, unknown>) {
  const initMsg = sentMessages.find((m) => m.method === 'ui/initialize');
  if (!initMsg) throw new Error('ui/initialize not sent');

  receiveFromHost({
    jsonrpc: '2.0',
    id: initMsg.id,
    result: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      hostCapabilities: { tools: {} },
      hostInfo: { name: 'test-host', version: '1.0.0' },
      hostContext: { theme: 'light' },
      ...overrides,
    },
  });
}

/** Create a SimpleMcpApp and connect it (auto-replies to initialize). */
async function createConnectedApp(initOverrides?: Record<string, unknown>) {
  const app = new SimpleMcpApp(
    { name: 'test-app', version: '0.1.0' },
    { tools: {} },
    { autoResize: false },
  );

  const connectPromise = app.connect();
  // Give the event loop a tick so the postMessage fires.
  await vi.waitFor(() => {
    if (!sentMessages.find((m) => m.method === 'ui/initialize')) {
      throw new Error('waiting for ui/initialize');
    }
  });
  replyToInitialize(initOverrides);
  await connectPromise;
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SimpleMcpApp', () => {
  beforeEach(() => {
    installPostMessageSpy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Initialization
  // ========================================================================

  describe('initialization', () => {
    it('sends protocolVersion in ui/initialize', async () => {
      await createConnectedApp();
      const init = sentMessages.find((m) => m.method === 'ui/initialize');
      const params = init!.params as Record<string, unknown>;
      expect(params.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    });

    it('sends appInfo in ui/initialize', async () => {
      await createConnectedApp();
      const init = sentMessages.find((m) => m.method === 'ui/initialize');
      const params = init!.params as Record<string, unknown>;
      expect(params.appInfo).toEqual({ name: 'test-app', version: '0.1.0' });
    });

    it('sends appCapabilities in ui/initialize', async () => {
      await createConnectedApp();
      const init = sentMessages.find((m) => m.method === 'ui/initialize');
      const params = init!.params as Record<string, unknown>;
      expect(params.appCapabilities).toEqual({ tools: {} });
    });

    it('includes backward-compat clientInfo and capabilities', async () => {
      await createConnectedApp();
      const init = sentMessages.find((m) => m.method === 'ui/initialize');
      const params = init!.params as Record<string, unknown>;
      expect(params.clientInfo).toEqual(params.appInfo);
      expect(params.capabilities).toEqual(params.appCapabilities);
    });

    it('parses new field names from host response', async () => {
      const app = await createConnectedApp();
      expect(app.getHostCapabilities()).toEqual({ tools: {} });
      expect(app.getHostVersion()).toEqual({
        name: 'test-host',
        version: '1.0.0',
      });
      expect(app.getHostContext()).toEqual({ theme: 'light' });
    });

    it('parses old field names from host response (backward compat)', async () => {
      const app = await createConnectedApp({
        // Old field names (no hostCapabilities/hostInfo)
        hostCapabilities: undefined,
        hostInfo: undefined,
        capabilities: { experimental: true },
        serverInfo: { name: 'legacy-host', version: '0.9.0' },
      });
      expect(app.getHostCapabilities()).toEqual({ experimental: true });
      expect(app.getHostVersion()).toEqual({
        name: 'legacy-host',
        version: '0.9.0',
      });
    });

    it('prefers new field names when both old and new are present', async () => {
      const app = await createConnectedApp({
        hostCapabilities: { tools: { v2: true } },
        capabilities: { tools: { v1: true } },
        hostInfo: { name: 'new-host', version: '2.0.0' },
        serverInfo: { name: 'old-host', version: '1.0.0' },
      });
      expect(app.getHostCapabilities()).toEqual({ tools: { v2: true } });
      expect(app.getHostVersion()).toEqual({
        name: 'new-host',
        version: '2.0.0',
      });
    });

    it('sends ui/notifications/initialized after handshake', async () => {
      await createConnectedApp();
      const initialized = sentMessages.find(
        (m) => m.method === 'ui/notifications/initialized',
      );
      expect(initialized).toBeDefined();
      expect(initialized!.id).toBeUndefined(); // notification, not request
    });
  });

  // ========================================================================
  // Teardown
  // ========================================================================

  describe('teardown', () => {
    it('handles ui/resource-teardown via onteardown', async () => {
      const app = await createConnectedApp();
      const handler = vi.fn().mockResolvedValue({ ok: true });
      app.onteardown = handler;

      receiveFromHost({
        jsonrpc: '2.0',
        id: 100,
        method: 'ui/resource-teardown',
        params: { reason: 'navigation' },
      });

      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
      expect(handler).toHaveBeenCalledWith({ reason: 'navigation' });
    });

    it('handles ui/teardown via onteardown', async () => {
      const app = await createConnectedApp();
      const handler = vi.fn().mockResolvedValue({ ok: true });
      app.onteardown = handler;

      receiveFromHost({
        jsonrpc: '2.0',
        id: 101,
        method: 'ui/teardown',
        params: {},
      });

      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    });

    it('returns empty object when no onteardown handler is set', async () => {
      await createConnectedApp();

      receiveFromHost({
        jsonrpc: '2.0',
        id: 102,
        method: 'ui/resource-teardown',
        params: {},
      });

      await vi.waitFor(() => {
        const response = sentMessages.find(
          (m) => m.id === 102 && m.result !== undefined,
        );
        expect(response).toBeDefined();
        expect(response!.result).toEqual({});
      });
    });
  });

  // ========================================================================
  // Incoming requests
  // ========================================================================

  describe('incoming requests', () => {
    it('dispatches tools/call to oncalltool', async () => {
      const app = await createConnectedApp();
      const handler = vi
        .fn()
        .mockResolvedValue({ content: [{ type: 'text', text: 'done' }] });
      app.oncalltool = handler;

      receiveFromHost({
        jsonrpc: '2.0',
        id: 200,
        method: 'tools/call',
        params: { name: 'my_tool', arguments: { x: 1 } },
      });

      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
      expect(handler).toHaveBeenCalledWith({
        name: 'my_tool',
        arguments: { x: 1 },
      });
    });

    it('dispatches tools/list to onlisttools', async () => {
      const app = await createConnectedApp();
      const handler = vi.fn().mockResolvedValue({ tools: [{ name: 'a' }] });
      app.onlisttools = handler;

      receiveFromHost({
        jsonrpc: '2.0',
        id: 201,
        method: 'tools/list',
      });

      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    });

    it('returns empty prompts array for prompts/list', async () => {
      await createConnectedApp();
      receiveFromHost({ jsonrpc: '2.0', id: 203, method: 'prompts/list' });
      await vi.waitFor(() => {
        const response = sentMessages.find(
          (m) => m.id === 203 && m.result !== undefined,
        );
        expect(response).toBeDefined();
        expect(response!.result).toEqual({ prompts: [] });
      });
    });

    it('returns -32601 for unknown methods', async () => {
      await createConnectedApp();

      receiveFromHost({
        jsonrpc: '2.0',
        id: 202,
        method: 'unknown/method',
        params: {},
      });

      await vi.waitFor(() => {
        const response = sentMessages.find(
          (m) => m.id === 202 && m.error !== undefined,
        );
        expect(response).toBeDefined();
        expect((response!.error as { code: number }).code).toBe(-32601);
      });
    });
  });

  // ========================================================================
  // Notifications
  // ========================================================================

  describe('notifications', () => {
    it('dispatches tool-input notification', async () => {
      const app = await createConnectedApp();
      const handler = vi.fn();
      app.ontoolinput = handler;

      receiveFromHost({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-input',
        params: { arguments: { id: '123' } },
      });

      expect(handler).toHaveBeenCalledWith({ arguments: { id: '123' } });
    });

    it('dispatches tool-result notification', async () => {
      const app = await createConnectedApp();
      const handler = vi.fn();
      app.ontoolresult = handler;

      receiveFromHost({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { content: [{ type: 'text', text: 'ok' }] },
      });

      expect(handler).toHaveBeenCalledWith({
        content: [{ type: 'text', text: 'ok' }],
      });
    });

    it('merges host-context-changed into getHostContext()', async () => {
      const app = await createConnectedApp();

      receiveFromHost({
        jsonrpc: '2.0',
        method: 'ui/notifications/host-context-changed',
        params: { locale: 'es-ES' },
      });

      expect(app.getHostContext()).toMatchObject({ locale: 'es-ES' });
    });

    it('ignores unknown notification methods without error', async () => {
      const app = await createConnectedApp();
      const errorHandler = vi.fn();
      app.onerror = errorHandler;

      receiveFromHost({
        jsonrpc: '2.0',
        method: 'ui/notifications/unknown-thing',
        params: {},
      });

      expect(errorHandler).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Outbound requests (wire-level method strings)
  // ========================================================================

  // Regression guard: the MCP Apps spec defines multi-word ui/* methods in
  // kebab-case. Earlier builds emitted camelCase, which spec-compliant hosts
  // rejected with "Method not found" — dropping fullscreen requests, external
  // link opens, and model-context updates silently.
  describe('outbound requests', () => {
    it('emits ui/request-display-mode (kebab-case) for requestDisplayMode()', async () => {
      const app = await createConnectedApp();
      sentMessages.length = 0;

      const pending = app.requestDisplayMode({ mode: 'fullscreen' });
      await vi.waitFor(() => {
        const req = sentMessages.find(
          (m) => m.method === 'ui/request-display-mode',
        );
        if (!req) throw new Error('request not sent');
      });

      const req = sentMessages.find(
        (m) => m.method === 'ui/request-display-mode',
      );
      expect(req!.params).toEqual({ mode: 'fullscreen' });

      receiveFromHost({
        jsonrpc: '2.0',
        id: req!.id,
        result: { mode: 'fullscreen' },
      });
      await pending;
    });

    it('emits ui/open-link (kebab-case) for openLink()', async () => {
      const app = await createConnectedApp();
      sentMessages.length = 0;

      const pending = app.openLink({ url: 'https://example.com' });
      await vi.waitFor(() => {
        const req = sentMessages.find((m) => m.method === 'ui/open-link');
        if (!req) throw new Error('request not sent');
      });

      const req = sentMessages.find((m) => m.method === 'ui/open-link');
      expect(req!.params).toEqual({ url: 'https://example.com' });

      receiveFromHost({ jsonrpc: '2.0', id: req!.id, result: {} });
      await pending;
    });

    it('emits ui/update-model-context (kebab-case) for updateModelContext()', async () => {
      const app = await createConnectedApp();
      sentMessages.length = 0;

      const pending = app.updateModelContext({ content: [] });
      await vi.waitFor(() => {
        const req = sentMessages.find(
          (m) => m.method === 'ui/update-model-context',
        );
        if (!req) throw new Error('request not sent');
      });

      const req = sentMessages.find(
        (m) => m.method === 'ui/update-model-context',
      );
      expect(req!.params).toEqual({ content: [] });

      receiveFromHost({ jsonrpc: '2.0', id: req!.id, result: {} });
      await pending;
    });
  });

  // ========================================================================
  // Lifecycle
  // ========================================================================

  describe('lifecycle', () => {
    it('connect() is idempotent', async () => {
      const app = await createConnectedApp();
      // Second connect should be a no-op.
      await app.connect();
      const initMessages = sentMessages.filter(
        (m) => m.method === 'ui/initialize',
      );
      expect(initMessages).toHaveLength(1);
    });

    it('close() removes listener and rejects pending requests', async () => {
      const app = await createConnectedApp();

      // Start a request that won't be answered.
      const pending = app.callServerTool({
        name: 'slow_tool',
        arguments: {},
      });

      app.close();

      await expect(pending).rejects.toThrow('Connection closed');
    });

    it('close() allows re-connection', async () => {
      const app = await createConnectedApp();
      app.close();

      // Reset captured messages.
      sentMessages.length = 0;

      const reconnect = app.connect();
      await vi.waitFor(() => {
        if (!sentMessages.find((m) => m.method === 'ui/initialize')) {
          throw new Error('waiting for ui/initialize');
        }
      });
      replyToInitialize();
      await reconnect;

      expect(app.getHostContext()).toEqual({ theme: 'light' });
    });
  });
});

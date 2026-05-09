# MCP Apps Protocol

This module covers the MCP Apps (SEP-1865) protocol specifics.
Note: Component developers rarely need this - @mcp-apps-kit/ui-react abstracts it.

## MCP Apps Protocol (Summary)

MCP Apps use JSON-RPC 2.0 over postMessage for iframe-host communication.

**Key Details:**
- Communication: postMessage JSON-RPC
- MIME type: `text/html;profile=mcp-app`
- URI scheme: `ui://<name>`
- Metadata: `_meta.ui.{...}`

Components use hooks (useToolResult, useWidgetState, etc.) that abstract the protocol details.

## MCP Apps Protocol (SEP-1865)

MCP Apps extends the Model Context Protocol to enable servers to deliver interactive user interfaces to hosts.

**IMPORTANT:** Component developers should use @mcp-apps-kit/ui-react hooks which abstract these details. This documentation is for reference and MCP server implementation.

### Communication Transport

UI iframes communicate with hosts via postMessage using JSON-RPC 2.0:

```typescript
// Send request to host
window.parent.postMessage({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "refresh_data", arguments: { id: "123" } }
}, '*');

// Listen for responses
window.addEventListener('message', (event) => {
  if (event.data?.id === 1) {
    const result = event.data.result;
    // Handle result
  }
});
```

### Lifecycle

1. **Initialize**: UI sends `ui/initialize` request with `{ protocolVersion, appInfo, appCapabilities }`
2. **Host responds**: With `{ protocolVersion, hostCapabilities, hostInfo, hostContext }`
3. **UI confirms**: Sends `ui/notifications/initialized` notification
4. **Tool input streaming:**
   - **4a.** Host sends **0..N** `ui/notifications/tool-input-partial` notifications while the model is generating tool args. Each partial carries the FULL current args (not a delta). Host auto-closes open JSON structures, but fields can be absent, null, or mid-key-transition.
   - **4b.** Host sends `ui/notifications/tool-input` ONCE when args are final.
5. **Tool result**: Host sends `ui/notifications/tool-result` when execution completes. This is the "streaming complete, UI becomes interactive" signal — components MUST keep interactive controls disabled (e.g. `<fieldset disabled={isStreaming}>`) until this fires.
6. **Teardown**: Host sends `ui/resource-teardown` request before closing

### Host Context

The host provides context via the initialize response:

```typescript
interface HostContext {
  theme?: "light" | "dark";  // IGNORE — AgntUX components render light-mode only
  displayMode?: "inline" | "fullscreen" | "pip";
  availableDisplayModes?: string[];
  locale?: string;           // BCP 47, e.g., "en-US"
  timeZone?: string;         // IANA, e.g., "America/New_York"
  platform?: "web" | "desktop" | "mobile";
  containerDimensions?: {
    width?: number;
    maxWidth?: number;
    height?: number;
    maxHeight?: number;
  };
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
}
```

> **Note — `theme` field:** Some hosts report `theme: "dark"`. AgntUX components render **light-mode only**. Do NOT branch on `theme`, do NOT use `dark:` Tailwind variants, do NOT register a theme-change handler that re-renders different styles. Light is authoritative regardless of host theme.

### UI → Host Requests

**tools/call** - Call an MCP tool:
```typescript
{ method: "tools/call", params: { name: "tool_name", arguments: {...} } }
```

**ui/open-link** - Open external URL:
```typescript
{ method: "ui/open-link", params: { url: "https://example.com" } }
```

**ui/message** - Send message to conversation:
```typescript
{ method: "ui/message", params: { role: "user", content: { type: "text", text: "..." } } }
```

**ui/request-display-mode** - Change display mode:
```typescript
{ method: "ui/request-display-mode", params: { mode: "fullscreen" } }
```

### Host → UI Requests

**tools/list** - List available tools:
```typescript
{ method: "tools/list" }
// Response: { tools: [...] }
```

**tools/call** - Call a tool:
```typescript
{ method: "tools/call", params: { name: "tool_name", arguments: {...} } }
```

**prompts/list** - List available prompts (must return empty array since MCP Apps don't use prompts):
```typescript
{ method: "prompts/list" }
// Response: { prompts: [] }
```

### Host → UI Notifications

**ui/notifications/tool-input-partial** - Streaming partial args (fires 0..N times before tool-input):
```typescript
{ method: "ui/notifications/tool-input-partial", params: { arguments: {...} } }
```
Each partial carries the FULL current args (not a delta). Host auto-closes open JSON structures so the payload always parses, but fields are frequently absent, arrays empty, nested objects null, and keys occasionally mid-transition between snake_case and camelCase as the LLM settles on naming. Views MAY render progressive loading/streaming states based on available fields; MUST NOT rely on partial arguments for critical operations (write-backs, tool calls, navigation). Keep interactive controls disabled until `tool-result` fires.

**ui/notifications/tool-input** - Tool arguments (sent once when args are final):
```typescript
{ method: "ui/notifications/tool-input", params: { arguments: {...} } }
```

**ui/notifications/tool-result** - Tool execution result:
```typescript
{ method: "ui/notifications/tool-result", params: { content: [...], structuredContent: {...} } }
```

**ui/notifications/host-context-changed** - Context updates:
```typescript
{ method: "ui/notifications/host-context-changed", params: { theme: "dark" } }
```

### UI → Host Notifications

**ui/notifications/size-changed** - Report content size:
```typescript
{ method: "ui/notifications/size-changed", params: { width: 400, height: 300 } }
```

### Theming

The component template includes a built-in light-mode color system. Colors are defined as CSS variables in `globals.css` and mapped to Tailwind semantic classes (`bg-background`, `text-foreground`, `bg-primary`, etc.).

Hosts can override colors via `hostContext.styles.variables`, which are applied by the `useHostStyleVariables()` hook. No custom theming code is needed in components.

### Display Modes

- **inline**: Default lightweight content in chat flow
- **fullscreen**: Immersive full-screen experience
- **pip**: Picture-in-picture floating window (may coerce to fullscreen on mobile)

Check `availableDisplayModes` before requesting a mode change.

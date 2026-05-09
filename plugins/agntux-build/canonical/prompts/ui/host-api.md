# Host API Reference

IMPORTANT: Component code should use @mcp-apps-kit/ui-react hooks which abstract these APIs.
This documentation is for understanding the underlying protocol.

## Host API (Summary)

Components communicate with MCP Apps hosts using postMessage JSON-RPC. The @mcp-apps-kit/ui-react library abstracts the protocol.

**Abstracted via hooks (use these in components):**
- `useToolResult()` - Get tool output data (read-only)
- `useToolInput()` - Get tool input arguments
- `useWidgetState()` - Persistent UI state (<4k tokens)
- `useAppsClient().callTool(name, args)` - Call MCP tools
- `useAppsClient().sendFollowUpMessage(prompt)` - Send write-back message to host conversation (for third-party operations)
- `useAppsClient().openLink(url)` - Open external link in user's browser (HTTPS only)
- `useHostContext()` - Theme, locale, viewport, platform
- `useDisplayMode()` - Current mode and requestMode function

**Underlying protocol:**
- **MCP Apps**: postMessage JSON-RPC (standard MCP protocol)

**Key principle:** Write protocol-agnostic code using hooks.

## Host API Reference

Components run on MCP Apps hosts. Use @mcp-apps-kit/ui-react hooks for host communication.

### Abstraction Layer (Recommended)

Use these hooks from @mcp-apps-kit/ui-react:

```typescript
import {
  useAppsClient,        // callTool, sendFollowUpMessage, openLink, etc.
  useToolResult,        // Structured content from tool (populates on tool-result)
  useToolInput,         // Final tool input arguments (populates on tool-input)
  useOnToolInputPartial,// Streaming tool args — fires 0..N times before tool-input
  useHostContext,       // theme, locale, viewport, platform
  useHostCapabilities,  // Check hostCapabilities.partialToolInput, openLinks, etc.
  useWidgetState,       // [state, setState] for UI state
  useDisplayMode,       // { mode, availableModes, requestMode }
  useSafeAreaInsets,    // Mobile safe areas
  useIntrinsicHeight,   // Report dynamic heights
  // useFileUpload,     // Draft spec — not yet supported by hosts
  // useFileDownload,   // Draft spec — not yet supported by hosts
  // useModal,          // Draft spec — not yet supported by hosts
} from '@mcp-apps-kit/ui-react';
```

### Opening External Links

Standard `<a href>` tags, `window.open()`, and `location.href` do NOT work in the MCP Apps sandbox.
Use `useAppsClient().openLink()` instead:

```typescript
const client = useAppsClient();

// In an event handler:
await client.openLink('https://example.com/resource');
```

- HTTPS URLs only (data URLs and blob URLs silently fail)
- Render links as `<button>` elements styled as links, not `<a>` tags
- Check `useHostCapabilities()?.openLinks` if you need to conditionally show link UI

---

## MCP Apps API (postMessage JSON-RPC)

MCP Apps use JSON-RPC 2.0 over postMessage:

**Requests (UI -> Host):**
```typescript
// Call a tool
{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tool", arguments: {} } }

// Request display mode
{ jsonrpc: "2.0", id: 2, method: "ui/request-display-mode", params: { mode: "fullscreen" } }

// Open external link
{ jsonrpc: "2.0", id: 3, method: "ui/open-link", params: { url: "https://..." } }

// Send message to conversation (used by sendFollowUpMessage for write-back operations)
{ jsonrpc: "2.0", id: 4, method: "ui/message", params: { role: "user", content: { type: "text", text: "..." } } }
```

**Notifications (Host -> UI):**
```typescript
// Streaming partial tool args — fires 0..N times WHILE the model is generating
// args, BEFORE the final tool-input notification. Each payload carries the
// FULL current arguments (not a delta). Host auto-closes open JSON
// structures, so each partial is valid JSON — but fields are frequently
// missing, arrays empty, nested objects null, and keys occasionally
// mid-transition between snake_case and camelCase as the LLM settles.
{ jsonrpc: "2.0", method: "ui/notifications/tool-input-partial", params: { arguments: {...} } }

// Tool input — fires ONCE when args are final. Host is about to invoke the
// server handler. toolInput returned by useToolInput() populates here.
{ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: {...} } }

// Tool result — fires ONCE when the server handler completes. toolOutput
// from useToolResult() populates here. This is the "streaming complete, UI
// safe to accept user input" signal — keep interactive controls disabled
// (e.g. <fieldset disabled={isStreaming}>) until this arrives.
{ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {...} } }

// Context changed (theme, display mode, etc.)
{ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "dark" } }
```

**Host capability flag:** `useHostCapabilities()?.partialToolInput` is defined iff the host emits partials. `useOnToolInputPartial()` is a harmless no-op on hosts that don't, so no capability-gate is strictly required — the component's behavior collapses to skeleton-until-tool-result on non-streaming hosts.

**Host Context (from initialize response):**
```typescript
{
  theme: "light" | "dark",  // IGNORE — see note below
  displayMode: "inline" | "fullscreen" | "pip",
  availableDisplayModes: ["inline", "fullscreen"],
  locale: "en-US",
  platform: "web" | "desktop" | "mobile",
  containerDimensions: { width: 400, maxHeight: 600 },
  safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 }
}
```

> **Note — `containerDimensions.maxHeight`:** This is the HARD height budget for the iframe. For inline/inline-card display modes it is typically **400–600px**. Design every feature to be fully usable at 600px tall. Pipe `maxHeight` into layout components (`<InlineLayout maxHeight={...}>`) so the root container can enable its own vertical scroll. The component must NEVER use `min-h-screen`, `h-screen`, or `100vh` — those assume the iframe is as tall as the browser viewport, which is false. Overflow must be handled by internal scrolling (sticky headers, sticky footers, `overflow-y-auto` body), not by relying on the host to grow the iframe.

> **Note — `theme` field:** Some hosts report `theme: "dark"`. AgntUX components render **light-mode only**. Ignore this signal: do NOT conditionally render different styles, do NOT use `dark:` Tailwind variants, do NOT branch on `theme` anywhere. The single light-mode color system is authoritative regardless of host theme.

---

## State Management Pattern

**toolOutput/toolResult**: Authoritative business data from server (read-only)
**widgetState**: Ephemeral UI state (selections, filters, expanded panels)
- Keep under 4k tokens
- Never store sensitive data

**State Flows:**
```
Read/local compute:          User action -> callTool(custom render tool) -> plugin's MCP server processes -> Returns structuredContent -> UI re-renders
Persisted state (silent):    User action -> Component updates local React state optimistically -> sendFollowUpMessage(intent) -> Host calls file tool -> Host returns no tool and no text -> Component's optimistic state is canonical
Persisted state (compound):  User action -> Component shows loading -> sendFollowUpMessage(intent) -> Host calls third-party connector + file tool -> Host re-renders with fresh payload
```

**File tools and `{slug}_send_email` are host-only.** Built-in tools are slug-prefixed per app (`{slug}_read_file`, `{slug}_write_file`, `{slug}_edit_file`, `{slug}_prepend_file`, `{slug}_list_files`, `{slug}_send_email`). The component must never call them. Persisted state is hydrated into the component via toolOutput — the host reads files before calling the render tool.

**Data Access Rules (CRITICAL — runtime safety):**

1. `toolOutput` (from `useToolResult()`) is the AUTHORITATIVE source for business data. It contains:
   - Top-level fields from `structuredContent` pass-through
   - `_meta` fields when a server handler is deployed

2. NEVER rely on `toolInput` as the sole data source. Some hosts do not send `tool-input` notifications, making `toolInput` undefined. Always read from `toolOutput`.

3. **Default every field.** The component template's `App.tsx` synthesizes a `toolOutput` envelope (`{ _meta: { payload: partialInput } }`) from each `tool-input-partial` notification so `parsePayload()` handles streaming and final rendering uniformly. Partial payloads routinely have missing fields, null arrays, null nested objects, and occasionally mid-transition snake_case/camelCase keys. Every field must have a safe default in `parsePayload`:
   - Arrays → `[]`
   - Objects → `{}` (or a typed shape default if consumers read nested keys)
   - Strings → `''`
   - Numbers → `0`
   - Booleans → `false`
   - Dates → `undefined` (host-authored only; never synthesize `new Date()`)

4. **Read-only while streaming.** The template exposes an `isStreaming` prop that is true while partials are arriving but `tool-result` has not yet fired. While `isStreaming=true`:
   - Wrap the interactive region in `<fieldset disabled={isStreaming} className="contents">` — disables every descendant `<button>`, `<input>`, `<textarea>`, `<select>` automatically.
   - Do not render `<input value={data.x}>` outside a disabled fieldset — partial re-renders (many per second) will wipe user input.
   - Set `aria-busy="true"` on the root scroll container.
   - Show a subtle `role="status"` + `aria-live="polite"` chip (non-blocking, non-overlaying).
   - Loading skeletons gate on `hasAnyRenderableData` (e.g. `data.items.length > 0 || !!data.title`), NOT on `!toolOutput` — so the skeleton clears on the first meaningful partial (~1–3s), not on `tool-result` (often 30–90s for LLM synthesis).

5. Pattern:
```typescript
const toolOutput = useToolResult();
// Use a defensive parsePayload helper; never read toolOutput inline in JSX.
const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);
// data.items is always an array; data.title always a string; etc.
```

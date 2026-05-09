# MCP Architecture

MCP server architecture for Relay Pattern workflows.

## MCP Architecture (Summary)

**Structure:**
- **Tool**: Registered on AgntUX MCP server, receives data from host, returns structuredContent for UI
- **Resource**: Serves HTML template for the MCP App component
- **Component**: Renders in host iframe, displays data and captures user actions

**Relay Pattern Role:**
- The AgntUX MCP server sits between the host and the UI
- Host passes third-party data to AgntUX tools as input arguments
- Tools return structuredContent that the UI renders
- User actions in the UI trigger follow-up tool calls back to the host

**Key Requirements:**
- Each component needs at least one tool and exactly one resource
- Tool returns `structuredContent` (visible to model and widget)
- Tools and resources are defined in `plugin-spec.json` and registered via the plugin scaffold sequence
- Built-in tools (no registration): 5 slug-prefixed file tools + `{slug}_send_email` — 6 per app total

**Resource URIs:**
- Resource URI: `ui://<component-name>`

## MCP Server Architecture (Relay Pattern)

### Built-in Tools (No Registration Required)

Every plugin's MCP server includes 6 built-in tools. Each tool is prefixed with the app's slug so the host can disambiguate across installed apps (e.g., `agntux_to_do_list_read_file`, `agntux_slack_companion_prepend_file`). The platform generates every slug with an `agntux_` prefix so built-in tool names never collide with third-party connector tools (Slack's `slack_channels_list`, GitHub's `github_issues_create`, etc.).
- **File tools (5):** `{slug}_read_file`, `{slug}_write_file`, `{slug}_edit_file`, `{slug}_prepend_file`, `{slug}_list_files`
- **Email (1):** `{slug}_send_email` — sends email via AgntUX domain (`workflows@agntux.ai`), supports to/cc/bcc, requires auth

For file-layout conventions (format, sigils, ordering, pagination, worked examples) see the File Structure context module.

### Relay Pattern Data Flow

In the Relay Pattern, the AgntUX MCP server acts as the relay between the AI host and the user interface:

```
1. Host calls Third-Party MCP Connector (e.g., Jira) to fetch data
2. Host calls AgntUX MCP Tool, passing fetched data as input arguments
3. AgntUX Tool processes data and returns structuredContent
4. MCP App UI renders the structuredContent
5. User interacts with UI (e.g., approves a ticket, updates a field)
6. UI calls AgntUX Tool with user's action
7. Host receives the action and calls Third-Party MCP Connector to execute it
```

**Security Model:** The host handles all authentication with third-party services. The AgntUX MCP server and MCP App never touch third-party API keys or credentials. Data flows through the host, which manages auth tokens and permissions.

### Tool Registration

Plugin tools are defined in `plugin-spec.json` and registered via the plugin scaffold sequence. Provide URIs in MCP Apps format (e.g., `ui://name`). The tool metadata:
- Sets metadata fields under `_meta.ui.*`
- Sets MIME type to `text/html;profile=mcp-app`

```typescript
{
  name: "get_data",
  description: "Fetches data and displays in component",
  inputSchema: { /* JSON Schema matching third-party connector output */ },
  _meta: {
    ui: {
      resourceUri: "ui://<component-name>",
      visibility: ["model", "app"]
    }
  }
}
```

**Tool Input Schema Design:**
- The inputSchema MUST include parameters for ALL data the host will relay from third-party connectors
- If a field isn't in the inputSchema, the host cannot pass it — the relay chain is broken
- The inputSchema should match as closely as possible to the third-party MCP connector's output schema
- This minimizes data transformation the host needs to do
- Keep schemas focused - only include fields the UI actually needs, but include ALL of them

**Anti-pattern:** Do NOT create a minimal inputSchema with only trigger parameters (e.g., just companyName). The host will see only companyName in the schema and will not know to fetch and pass third-party data.

**No Dummy Data for Plugin Render Tools:**
- Plugin render tools must validate their input and return a helpful error if required relay data is missing
- The error should instruct the host to read the skill, fetch data from third-party connectors, and retry

**Server Handler for Relay Pattern Tools:**
- Each plugin render tool should have a handler in `server/tools/{tool-name}.ts`
- The handler receives relay input from the host and transforms it into the component's expected output format
- Return structure: top-level fields become `structuredContent`, returned `_meta` object provides widget-only data
- Without a handler, the API passes relay input through as a default — but handlers enable validation and transformation

**Plugin MCP Server Constraints:** The plugin's MCP server is stateless — see the Relay Pattern section for full constraints on what tools to create (and not create) on the plugin's MCP server.

**Tool Response Structure:**
```typescript
{
  // Visible to model AND widget
  structuredContent: {
    // Your typed data here
  },

  // Text fallback for non-UI hosts
  content: [
    { type: "text", text: "Fallback text representation" }
  ],

  // Widget-only metadata (hidden from model)
  _meta: {
    timestamp: "2025-01-11T00:00:00Z"
  }
}
```

### Resource Registration

```typescript
{
  uri: "ui://<component-name>",
  name: "<component-name>",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    ui: {
      prefersBorder: true,
      domain: "optional-subdomain",
      csp: {
        connectDomains: ["https://api.example.com"],
        resourceDomains: ["https://cdn.example.com"]
      }
    }
  }
}
```

**Resource Content Requirements:**
- HTML template with embedded CSS and JavaScript
- Structure: `<div id="root"></div><style>...</style><script type="module">...</script>`
- Single bundle that can be inlined by the MCP server

### Metadata Reference

**MCP Apps Metadata (_meta.ui.{...}):**
- `ui.prefersBorder`: Whether to render with border (boolean)
- `ui.domain`: Optional dedicated domain (string)
- `ui.csp`: CSP config with `connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`
- `ui.resourceUri`: Resource URI for tool output rendering
- `ui.visibility`: Array of ["model", "app"] - who can access the tool

---

## Performance Requirements

**Core Principle:** Component must render fast and respond instantly

**Requirements:**
- Initial render < 500ms perceived load time
- Interactions < 100ms response time
- Use async patterns -- avoid blocking operations
- Lazy load heavy components if needed
- Optimize bundle size -- remove unused code
- Minimize re-renders with React.memo, useMemo, useCallback
- Optimize images with appropriate formats and sizes

---

## Server-Side Tool Handlers

Tools can have custom server-side handlers that execute real logic (data validation, parsing, restructuring for UI compatibility).

**Handler Pattern:**
- Handler files live in `server/tools/{tool-name}.ts`
- Each exports a `handler` function matching the `ToolHandler` type
- Handlers are re-exported from `server/index.ts` by tool name
- At build time, esbuild bundles all handlers into `out/server-bundle.mjs`
- At runtime, the component-server loads the bundle and executes the matching handler

**ToolHandler Type:**
```typescript
type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext,
) => Promise<Record<string, unknown>>;

interface ToolContext {
  secrets: Record<string, string>;  // API keys from app_secrets table
  appId: string;
  componentId: string;
}
```

**Common Handler Use Cases in Relay Pattern:**
- Validate and sanitize data received from the host
- Parse and restructure third-party data for UI-friendly format
- Aggregate or filter data before rendering
- Format dates, currencies, and locale-specific values

**Naming Convention:**
- Tool name: `weather_get_current`
- Handler file: `server/tools/weather-get-current.ts`
- Export in index.ts: `export { handler as weather_get_current } from './tools/weather-get-current.js'`

**Execution Environment:**
- Node.js vm sandbox with restricted globals
- 30-second timeout per handler invocation
- Available: fetch, console.log, JSON, Date, setTimeout, URL, URLSearchParams
- All npm dependencies bundled at build time (no runtime install)

# Relay Pattern

## Relay Pattern (Summary)

**Third-party is canonical; files are supplementary.** If a connected third-party MCP server can return the data, fetch it each session rather than persisting. Files exist only for user preferences, workflow-specific state the third-party can't represent, and heartbeat-populated summaries when fresh-fetch latency is unacceptable.

The Relay Pattern is the core architecture for workflow automation:
1. Host (Claude) calls Third-Party MCP Connector to fetch data
2. Host passes data to AgntUX MCP Server tool
3. AgntUX tool returns structuredContent rendered by MCP App UI
4. User interacts with UI
5. Host executes write-actions via Third-Party Connector

**Security:** Host handles all third-party authentication. AgntUX never touches API keys.
**Scope:** Ideal workflows have 3-5 steps. Break larger ones into multiple workflows.
**Tool Input Schema:** Must include ALL data fields the host will relay — not just trigger parameters.
**No Dummy Data:** Plugin render tools never return dummy data. Missing input = error with instructions.

## The Relay Pattern

### Overview

The Relay Pattern is the architecture for automating business workflows through AI hosts. It creates a relay chain: the host fetches data from third-party services, relays it to the AgntUX MCP server, which renders an interactive UI for the user. User actions relay back through the host to execute operations on the third-party service.

### Data Flow

```
Step 1: Host calls Third-Party MCP Connector
        Example: "Get all open Jira tickets for sprint 42"

Step 2: Third-Party Connector returns data to Host
        Example: [{ key: "PROJ-123", summary: "Fix login bug", status: "In Progress" }, ...]

Step 3: Host calls AgntUX MCP Tool, passing the data as input
        Example: agntux_show_sprint_board({ tickets: [...], sprintName: "Sprint 42" })

Step 4: AgntUX Tool returns structuredContent -> MCP App UI renders
        Example: Interactive sprint board with ticket cards, status columns, action buttons

Step 5: User interacts with UI
        Example: User drags ticket to "Done" column, clicks "Approve"

Step 6: UI calls sendFollowUpMessage() -> Host receives natural-language prompt
        Example: Component sends "Move issue ENG-42 to status Done"

Step 7: Host calls Third-Party Connector based on the message
        Example: Host calls jira_update_issue with issue_key: "ENG-42", status: "Done"
```

### Third-Party Connector Patterns

Third-party MCP connectors are external MCP servers that interface with business tools:
- **Jira**: Sprint data, ticket management, status updates
- **HubSpot**: Deal pipelines, contact management, activity tracking
- **Asana**: Task management, project tracking, team workload
- **Salesforce**: CRM data, opportunity management, reporting
- **Slack**: Channel management, message sending, notifications
- **Google Workspace**: Calendar, Drive, Sheets integration

The host (Claude) connects to these via MCP connector configuration. The AgntUX workflow doesn't need to know the connector implementation details -- it only needs to know:
1. What data the connector provides (to design the tool input schema)
2. What actions the connector supports (to design user interactions)

### Security Model

**Host handles all authentication:**
- Third-party API keys and OAuth tokens are managed by the host
- The AgntUX MCP server never sees or stores third-party credentials
- Data passes through the host, which enforces access permissions
- The MCP App UI runs in a sandboxed iframe with no direct API access

**Data flow security:**
- Host validates data before passing to AgntUX tools
- AgntUX tools validate input schema before processing
- UI only displays data received via structuredContent
- User actions are relayed back through the host via sendFollowUpMessage — the host's LLM decides which tool to call and handles authorization
- Every user action that requires a **third-party** service MUST call sendFollowUpMessage(). This includes status changes, mark-as-read, archive, dismiss, acknowledge, and other state transitions — not just create/update/delete operations. If in doubt about whether a third-party connector is needed, send the follow-up message; the host can decide whether a matching connector tool exists
- **Own-server custom tools** (defined by this plugin's MCP server for stateless rendering transforms) may be called by the component directly via callTool() — no sendFollowUpMessage needed. These tools never mutate persisted state.
- **File tools and `{slug}_send_email` are host-only**, even though they live on the same plugin's MCP server. They are slug-prefixed per app (e.g., `agntux_to_do_list_read_file`). Slugs always start with the platform's `agntux_` marker so built-in tool names never collide with a third-party connector's native tools (Slack's `slack_channels_list`, GitHub's `github_issues_create`, etc.). The component NEVER calls `{slug}_read_file`, `{slug}_write_file`, `{slug}_edit_file`, `{slug}_prepend_file`, `{slug}_list_files`, or `{slug}_send_email`. For any persisted state change or email intent driven by the UI, the component updates its local React state optimistically and emits sendFollowUpMessage describing the intent; the host performs the file operation or sends the email per the SKILL.md.
- The tool description and SKILL.md MUST instruct the host not to add any additional text, summary, or commentary after rendering the UI. The interactive UI speaks for itself — any text the host adds after rendering distracts from it

### Tool Input Schema Design

The tool's inputSchema is the contract between the host and the tool. It determines what data the host can pass. For the relay pattern to work, the inputSchema MUST include parameters for ALL data the host fetches from third-party connectors.

**If a field isn't in the inputSchema, the host cannot pass it, and the relay chain is broken.**

WRONG — minimal trigger-only schema:
  inputSchema: { companyName: string }
  Problem: Host has no way to pass the deal, contact, or engagement data it fetched.

CORRECT — full relay data schema:
  inputSchema: {
    companyName: string (required),
    company: { id, name, industry, ... },
    deal: { id, stage, value, ... },
    contacts: [{ name, title, ... }],
    timeline: [{ type, date, ... }]
  }
  The host knows exactly what data to fetch and pass.

**Error Handling for Missing Data:**
Plugin render tools must NOT use dummy/hardcoded data. If required relay data is missing from the input, the tool should return an error response directing the host to:
1. Read the relevant SKILL.md for the complete workflow
2. Call the appropriate third-party MCP connector tools to fetch the required data
3. Retry the AgntUX tool call with the complete data

### Server-Side Handler Role

The AgntUX tool is implemented as a server-side handler (`server/tools/{tool-name}.ts`). The handler:
1. Receives relay input (all data fields from the inputSchema, as passed by the host)
2. Validates required fields are present
3. Transforms the data into the component's expected format:
   - Top-level fields → structuredContent (what the model and host see)
   - _meta fields → widget-only data (what the component renders from toolOutput._meta)
4. Returns the structured result

Without a handler, the API passes relay input through as a default. But handlers enable:
- Input validation (return helpful errors if required relay data is missing)
- Data transformation (compute derived fields like contactCount, format dates, etc.)
- External API enrichment (fetch additional data using context.secrets)

### Plugin MCP Server Constraints

The plugin's MCP server's **custom** tools are stateless relay data transformers: receive data from the host, validate, transform, and return structuredContent for rendering. However, every plugin's MCP server also has built-in slug-prefixed file tools (`{slug}_read_file`, `{slug}_write_file`, `{slug}_edit_file`, `{slug}_prepend_file`, `{slug}_list_files`) for persistent cross-session storage.

**Do NOT create these kinds of custom tools on the plugin's MCP server:**
- update_talking_points(dealId, points) — custom stateful tool should not exist; route the UI event through sendFollowUpMessage so the host writes the appropriate file, or use widgetState for ephemeral UI edits
- save_preferences(userId, prefs) — custom stateful tool should not exist; route through sendFollowUpMessage so the host writes preferences, or use widgetState for ephemeral ones
- update_deal_stage(dealId, stage) — use sendFollowUpMessage to delegate to the host, which calls the third-party connector

**The component relies on the host for data and persistence:**

The detailed rule on what belongs in files vs. what to re-fetch is owned by each plugin's `skills/sync/SKILL.md` — that's where the workflow's file schema lives. The summary form is in `state-management.md` ("Two Actors Manage Files"). The component never sees the file layout directly; it only sees the payload the host hands back through `toolOutput`.

- Read: host fetches from third-party connectors AND/OR reads persisted state files (`{slug}_read_file`) before calling the render tool; the component receives the combined payload via structuredContent/_meta
- Write (third-party): component uses sendFollowUpMessage to delegate write-back to the host, which routes to the appropriate third-party MCP tool
- Write (persisted state): component uses sendFollowUpMessage to delegate; the host performs the file tool call per the SKILL.md. Component NEVER calls file tools itself.
- Ephemeral UI state (edited notes, selected filters, sort order): use widgetState — no tool needed

### Workflow Scope Guidance

**Ideal: 3-5 Steps**
A well-scoped workflow follows this pattern:
1. Host fetches data from third-party connector
2. Host passes data to AgntUX tool
3. User reviews and interacts with UI
4. Host executes user's action via third-party connector
5. Component updates its own UI optimistically via widgetState (host does NOT re-render)

**Looping is OK:**
- Review items one by one (ticket triage, deal review)
- Iterative refinement (edit, preview, edit again)
- Batch operations (approve multiple items)

**When to break into multiple workflows:**
- 10+ distinct steps that don't form a natural loop
- Multiple unrelated business processes combined
- Different user roles involved at different stages
- Different third-party services needed for unrelated tasks

**One workflow = one business process:**
- Multiple UI components per workflow are fine (different views for different steps)
- But don't combine "Jira sprint review" and "HubSpot deal tracking" into one workflow

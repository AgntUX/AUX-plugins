# Stage 3 — connect to the source

Before we can see what the new plugin can do, we need the host
connected to the underlying system. Slack, Linear, Notion, GitHub,
Google Calendar — most popular services have a connector available
in the host's connector marketplace. AgntUX plugins never authenticate
directly; they always go through the host's connector layer.

## What you check

1. **Is the connector available in the host?** Use the host's tool
   inventory (the same one stage 4 will read). Resolve via
   `ToolSearch` with the connector display name as the query. If
   `mcp__claude_ai_{ConnectorName}__*` tools appear in the resolved
   set, the connector is available.

2. **Is the connector authorised?** Probe one read-only tool. If the
   host returns an "authentication required" error envelope, the
   connector exists but isn't connected. If a tool with no required
   args succeeds, you're good.

   Pick the lightest read-only tool the connector exposes — usually
   `whoami`, `list_users`, `me`, `get_self`, or similar. Don't pick
   something that triggers a write or scans many records.

## Branch on what you find

### A — connector exists and is authorised

Tell the user:

> Connected to {connector-display-name}. Let's see what it can do.

Save:
```json
{ ..., "connector_authorized": true, "connector_check_tool": "..." }
```

Move to [`04-discover-tools.md`](04-discover-tools.md).

### B — connector exists but isn't authorised

Tell the user the host needs to connect:

> {Connector-display-name} is available in your host's connector
> marketplace, but it's not connected yet. Open
> {Claude Desktop / Cowork / claude.ai} → Connectors and authorise
> {connector-display-name}.
>
> Let me know when that's done and I'll keep going.

**Stop until the user confirms.** Don't poll, don't auto-retry. When
the user says "done" or "ready" or similar, re-run the check (probe
the same tool again). On success, advance. On still-not-connected,
explain what error came back and ask the user to try again.

### C — connector isn't available in the host

This is the hard case. Some systems don't have a connector yet
(typically newer or less common services). Two sub-paths:

#### C.1 — there's a public MCP server for it

If the system publishes a third-party MCP server, the user can
install it directly. Tell them:

> {Connector-display-name} doesn't have a connector in the host yet,
> but it has a public MCP server at {URL}. To use it, you'll need
> to add it to your host's `~/.claude.json` (or the equivalent for
> your host) under `mcpServers`. Once it's running, AgntUX plugins
> can talk to it the same way.
>
> Want to set that up now and come back, or build a stub plugin we
> can wire up later?

If they wire up the MCP server, restart stage 3.

#### C.2 — no MCP server exists at all

The work is bigger than this flow can handle — building the MCP
server itself is a separate engineering project, not a plugin. Be
honest:

> {Connector-display-name} doesn't have an MCP server yet, which
> means there's no way for AgntUX (or any other tool) to read
> {connector-display-name} data programmatically. Building the
> MCP server is a different kind of project — it's the layer below
> AgntUX plugins.
>
> Two paths from here:
> 1. Open an issue at the {connector-display-name} repo or
>    `https://github.com/modelcontextprotocol` asking for an MCP
>    server.
> 2. Open an issue at
>    `https://github.com/AgntUX/AUX-plugins/issues` for the
>    AgntUX team to consider a connector.
>
> Once an MCP server lands, we can build the AgntUX plugin in 30
> minutes flat. Until then, this is where the flow stops — sorry
> for the dead end.

Stop. Save `session_status: "blocked-no-mcp"`.

## What you DON'T do

- Don't try to authenticate the connector yourself. The host owns
  authentication.
- Don't proceed to stage 4 with a "we'll figure it out later"
  attitude — stage 4 needs the connector live to discover tools.
- Don't loop on the "not authorised" error more than twice. If the
  user can't get the host to connect, redirect to the host's support
  channel.
- Don't show the user the raw error envelope from the host. Translate
  to plain language: "the host says it needs you to authorise this
  connector first."

## Saved state at end of stage 3

```json
{
  ...,
  "connector_authorized": true,
  "connector_check_tool": "mcp__claude_ai_Linear__me",
  "connector_check_passed_at": "2026-05-08T..."
}
```

## Path back

If the user has to leave to authorise the connector and the
conversation ends mid-stage, the next `/agntux-build:build`
invocation reads `sessions/{session-id}.json`, sees
`stage: 3, connector_authorized: false`, and re-runs the check.

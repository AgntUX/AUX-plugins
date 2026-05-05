# @agntux/mcp-license

Internal AgntUX workspace package. Wraps an MCP server's `tools/call`
handler in a host-agnostic license gate.

`resources/read` is intentionally **not** gated — see "Why only tools/call"
below.

## Usage

```ts
import { createLicenseGate } from "@agntux/mcp-license";
import pkg from "../package.json" with { type: "json" };

const gate = createLicenseGate({
  pluginName: "agntux-slack",
  pluginVersion: pkg.version,
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const err = await gate.requireValidLicense({
    reason: "tools/call",
    toolName: request.params.name,
  });
  if (err) return err;
  // ... existing handler logic
});

// resources/read passes through directly; do NOT call gate.requireValidLicense
// from this handler.
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  return handleUIResource(request.params.uri);
});
```

## Why only tools/call

Two reasons learned the hard way:

1. **Concurrent gate calls race on first-pair creation.** Some hosts (e.g.
   MCPJam Inspector) fire `CallTool` and `ReadResource` close together when
   rendering an MCP App. With both surfaces gated, each call generates its
   own pairing nonce, and the second writer wins `~/.agntux/.pairing` — the
   URL the LLM displayed doesn't match the nonce the gate later polls. The
   user approves URL A, the gate polls nonce B, and pairing never completes.
   `tools/call` alone is naturally serialized by the LLM agent loop.
2. **Error envelope shape mismatch.** The gate returns
   `{ isError, content: [...] }` (CallToolResult shape, singular `content`).
   `ReadResourceResult` requires `contents` (plural). Returning the gate
   envelope from a ReadResource handler trips strict SDK validation and
   blocks the iframe from loading.

The UI bundle served by `resources/read` is a static shell with no
proprietary value without the data feed served by the gated tool surface,
so leaving it ungated is acceptable for ELv2 license-key purposes.

## Dev mode

Set `AGNTUX_DEV_MODE=1` to bypass the gate entirely (used by MCPJam Inspector
and local UI iteration).

## API base override

Set `AGNTUX_API_BASE` (e.g. `http://localhost:3001`) to point the gate at a
local web app. Default is `https://app.agntux.ai`.

## Public-key rotation

Edit `src/keys.ts` `ACTIVE_KEYS`. Bump this package version. All consuming
plugins pick the rotation up on their next rebuild.

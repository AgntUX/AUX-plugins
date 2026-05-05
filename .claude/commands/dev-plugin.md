---
description: Build a plugin's UI handler components + mcp-server, verify bundle sync, and launch the MCP server in HTTP_MODE for local testing
argument-hint: <slug> [--port <n>]
allowed-tools: Bash(node scripts/build-plugin.mjs *), Bash(ls *), Bash(cat *), Read
---

Build `plugins/$ARGUMENTS/` end-to-end (every UI handler component, then
the mcp-server which embeds them, then `check:bundle-sync`) and launch the
MCP server in HTTP_MODE so a separately-running MCPJam Inspector can
connect to it.

```
node scripts/build-plugin.mjs $ARGUMENTS --serve
```

This is the same script CI runs, so a green local run means a green CI
run. Default HTTP port is `5180`; pass `--port <n>` to override.

## What this replaces

The legacy contributor flow required a manual `cd` chain:

```
cd plugins/$ARGUMENTS/ui-handlers/<name>/component && npm run build
cd ../../../mcp-server && npm run build && npm run check:bundle-sync
HTTP_MODE=1 PORT=5180 node dist/index.js
```

…repeated once per UI handler component. Easy to forget a handler when a
plugin grows; impossible to run from a Claude Code session without
spawning multiple `cd` Bash calls. The slash command and the underlying
`scripts/build-plugin.mjs` collapse the whole sequence into one
invocation.

## Prereqs

- Node 20 (see repo-root `engines`).
- The user runs MCPJam Inspector themselves in another terminal — we don't
  bundle it. Typical command: `npm --prefix /path/to/MCPJam-inspector run dev`.

## After the server starts

The script logs the URL to stdout — point MCPJam Inspector at
`http://127.0.0.1:<port>/mcp`. Ctrl-C to stop.

## When to use this

- The user says "build agntux-slack and run the MCP server for local testing".
- The user says "/dev-plugin agntux-core".
- The user is iterating on a UI handler component and needs the server to
  reflect their latest edit (the `check:bundle-sync` step protects them
  from accidentally serving a stale embed).

## When NOT to use this

- Just running tests: use `npm --prefix plugins/$ARGUMENTS test` instead.
- Just verifying the bundle: use
  `npm --prefix plugins/$ARGUMENTS/mcp-server run check:bundle-sync`.
- Building every plugin at once: use `node scripts/build-plugin.mjs --all`.

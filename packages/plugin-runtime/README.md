# @agntux/plugin-runtime

Cross-environment runtime contract for AgntUX view-tool plugins.

A view tool is a server-side handler that produces structured data for an
MCP App UI bundle. The handler is authored once and runs in **two**
environments:

| Environment             | Where it runs                              | Factory                                    |
|-------------------------|--------------------------------------------|--------------------------------------------|
| Local agntux-core       | The user's machine, against `<agntux>/`    | `createLocalFsContext` (this package)      |
| Remote `/api/mcp`       | `app/` server, against S3 + `team_files`   | `createS3FsContext` (`app/lib/mcp/runtime`) |

Both factories implement the same `ViewToolContext` interface so a handler
can be written once against `(args, ctx)` and dispatched in either lane.

## Public surface

```ts
import {
  // FROZEN CONTRACT
  ViewToolContext,
  ViewTool,
  ViewToolModule,
  ViewToolFsError,
  // pure helpers (safe for handlers)
  parseActionFile,
  parseFrontmatter,
  extractSection,
  // manifest schema (shared with Phase 3 / Phase 5)
  ViewToolsManifestSchema,
} from "@agntux/plugin-runtime";

import {
  // local-fs only — gated under a subpath import
  createLocalFsContext,
  resolveAgntuxRoot,
} from "@agntux/plugin-runtime/local-fs";
```

The root barrel does **not** expose `createLocalFsContext` or
`resolveAgntuxRoot`. The S3 factory in `app/` cannot accidentally import a
`node:fs`-backed code path that way.

## Trust model

Compiled view-tool bundles import **only** `@agntux/plugin-runtime`.
`esbuild` externalises the package so the bundle has no other runtime
imports. The handler-visible surface is:

1. `ctx.fs.{readFile,list,exists}` — fs-shaped reads (S3-backed in the
   remote lane, `node:fs/promises`-backed locally).
2. `ctx.scope` — `{ user_id, organization_id, team_slug?, leader_view_slug? }`.
3. `ctx.now()` / `ctx.log()` — injectable for deterministic tests + structured
   logging.
4. The pure helpers re-exported from this package (`parseActionFile`,
   `parseFrontmatter`, `extractSection`, manifest-schema exports).

No `node:fs`, no `fetch`, no `process.env`, no `child_process` reaches a
compiled view-tool bundle. Phase 5's `invariant-checker` enforces this at
build time via a grep over the emitted bundle.

## Error model

`ViewToolFsError` mirrors `BlobUploadError` / `ContainerLookupError` from
`app/lib/sync/` — `{ code, path, status, message }`. The four codes:

| Code         | Status | When it fires                                              |
|--------------|--------|------------------------------------------------------------|
| `not-found`  | 404    | File / container does not exist                            |
| `forbidden`  | 403    | Caller is not a member of the resolved container           |
| `transient`  | 503    | Recoverable I/O failure (S3 5xx, DB timeout)               |
| `schema`     | 500    | Caller-detected schema/parse failure                       |

Sub-plan 2's `/api/mcp` route maps each to a JSON-RPC error envelope.

## Immutability + scope narrowing

`ViewToolContext` is immutable. Handlers narrow scope with
`ctx.withScope({ team_slug: "engineering" })`, which returns a NEW context
sharing the parent's memoized auth gate — narrowing scope is free of extra
DB round-trips.

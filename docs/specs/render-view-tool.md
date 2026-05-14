# `plugin-toolkit-test render-view-tool` — specification

Status: **Specification only.** Harness implementation is a follow-up PR in
the [`agntux-plugin-dev`](https://github.com/AgntUX/agntux-plugin-dev)
marketplace (where `plugin-toolkit-test` lives); not in scope for this
phase of AUX-plugins.

## Why this exists

Phase 7 of the AgntUX master plan splits plugins into two kinds:

- **Local-server plugins** (have `mcp-server/`): keep the existing
  `/dev-plugin {slug}` loop — `build-plugin.mjs --serve` launches the
  server in `HTTP_MODE` so MCPJam Inspector can attach.
- **Source plugins** (have `view-tool/` only): no local MCP server to
  launch. `--serve` cannot work; developers need a different inner loop.

`render-view-tool` is that replacement. It loads the compiled view-tool
module out of `view-tool/dist/`, runs `handle({}, fakeCtx)` against an
in-memory blob fake, and writes the rendered UI resource HTML to a temp
file (or serves it on a free port) so MCPJam Inspector can render the
iframe via its "static HTML" mode.

## CLI signature

```
plugin-toolkit-test render-view-tool \
  --plugin <slug> \
  [--tool <tool-name>] \
  [--args '<json>'] \
  [--fixtures <path>] \
  [--port <n> | --file] \
  [--cwd <path>]
```

| Flag | Required | Default | Description |
|---|---|---|---|
| `--plugin <slug>` | Yes | — | Plugin slug (e.g. `agntux-slack`). Resolved relative to `--cwd` or current dir. |
| `--tool <tool-name>` | No | The plugin's lone view tool from its manifest | Which view tool to invoke (a plugin may, post-v1, declare more than one). |
| `--args '<json>'` | No | `{}` | JSON object passed as the first arg to `handle(input, ctx)`. |
| `--fixtures <path>` | No | `<plugin>/__tests__/fixtures.json` if present | Pre-seeds the blob fake with deterministic data. |
| `--port <n>` | No | — | Serve the rendered HTML on `http://localhost:<n>/`. Mutually exclusive with `--file`. |
| `--file` | No | default if `--port` is omitted | Write to a temp file and print a `file://` URL. |
| `--cwd <path>` | No | `process.cwd()` | Project root for resolving the plugin tree. |

## Input format

1. **Compiled view-tool module.** Resolved at
   `<plugin>/view-tool/dist/<slug>-view.js` (path comes from
   `view-tools.manifest.json` so a future schema change is transparent).
   Loaded via dynamic `import()`. Must export the manifest's named
   `handle(input, ctx)` function (or a default export with `.handle`).
2. **S3 fake config / blob fake.** The harness constructs the same
   in-memory `BlobFake` used by Phase 4's unit tests (`blob-fake.ts` in
   `@agntux/plugin-runtime`'s `__tests__/` tree, exported via a
   testing-only entry point — exact path TBC when the package lands).
   The fake is seeded with:
   - Any fixtures pointed to by `--fixtures`.
   - A synthetic `(container_id, path)` index that matches the plugin's
     declared sources.
3. **`ViewToolContext`.** Built from `@agntux/plugin-runtime`'s
   `createLocalFsContext({ blob, user, org })` factory, parameterized with
   a deterministic fake user/org so the runtime sees a stable identity.
4. **Tool input.** Either `{}` (default) or the parsed `--args` JSON.

## Output format

1. **Rendered UI resource HTML.** Whatever the view tool's response
   nominates via `_meta.ui.resourceUri` — that resource's content is
   resolved from `view-tool/dist/ui-resources/<name>.html`, optionally
   templated with the `structuredOutput` JSON if the view tool returns
   one. The harness writes/serves that HTML verbatim.
2. **Structured-output diff (stdout).** If `--fixtures` includes a
   `expected.json`, the harness compares the tool's structured output to
   the expected value and emits a JSON diff. Non-fatal when fixtures
   omit `expected.json`.
3. **URL (stdout, last line).** Either a `file://` path (default) or
   `http://localhost:<port>/` (with `--port`). The developer pastes this
   into MCPJam Inspector's static-HTML view.

## Exit codes

- `0` — the view tool's `handle()` resolved without throwing, the UI
  resource rendered, and (if applicable) the structured-output diff was
  empty.
- `1` — the view tool threw, the manifest could not be parsed, the
  compiled module failed to import, or `--plugin` is missing/invalid.
- `2` — the view tool resolved cleanly but its structured output diverged
  from `expected.json`. The URL is still printed so the developer can
  eyeball the discrepancy.
- `3` — the port requested by `--port` is in use.

## Interactions out of scope

- **OAuth / remote MCP server.** This harness never talks to the
  AgntUX-hosted remote MCP server; the `ViewToolContext` is fully local.
- **Live S3.** Always backed by the in-memory blob fake. Developers
  pointing at a live S3 bucket are using the wrong tool.
- **Multi-tool fan-out.** v1 invokes one tool at a time. Iterating across
  every tool in a manifest is a wrapper concern.
- **The full agntux-build `host-renderer/` / `test-harness/` workflow.**
  Phase 7 explicitly defers any decision on obsoleting those subtrees; the
  `render-view-tool` subcommand is the source-plugin replacement only.

## Implementation tracking

- Implementation PR: TBC in `AgntUX/agntux-plugin-dev`.
- Phase 7 dependency: blocked on Phase 4 shipping the testing-only entry
  for `BlobFake` from `@agntux/plugin-runtime`.
- Definition of done (for the follow-up): `render-view-tool --plugin
  agntux-slack` renders the Slack triage UI from a fixture in under 2s
  on a developer laptop, with exit code 0 and a printable URL.

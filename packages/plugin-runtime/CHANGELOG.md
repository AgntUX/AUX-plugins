# Changelog

All notable changes to `@agntux/plugin-runtime` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] — 2026-05-18

### Added

- **`renderConfirmationText(uiLabel)`** — canonical wording builder for
  the `content[].text` block every view-tool handler should ship
  alongside `structuredContent`. The function returns a ~5-sentence
  explanation of the MCP Apps lifecycle (the host materializes
  `structuredContent` into the iframe; the iframe IS the user-visible
  result; no follow-up output / visualization / tool call is needed).
  Frozen anchor strings — `"iframe"`, `"host"`, `"MCP App"` — are
  asserted by every plugin's `__tests__/payload-shape.test.ts` and
  by the new marketplace linter pass 14 / E29.
- **`ViewTool.handle`** return type widened from
  `Promise<{ structuredContent: Out }>` to
  `Promise<{ content?: Array<{ type: "text"; text: string }>;
  structuredContent: Out }>` so handlers can ship a `content[]` block
  without a type-level fight. `content[]` is optional for backwards
  compatibility, but every production plugin and the canonical
  agntux-build template ship it on every success and error branch.

### Why

Production bug observed in Claude Cowork on 2026-05-18: after
`/agntux triage` correctly fired the triage view tool and the host
rendered the iframe, the model also (a) built a duplicate HTML widget
via the host's `visualize` tool and (b) wrote 5 paragraphs of
commentary summarizing the iframe the user could already see. Root
cause: the handler returned only `structuredContent`, so the model
never received an explicit signal that the host had materialized the
iframe — the JSON blob looked like raw data awaiting downstream
processing. Centralizing the wording here means we can tune the
explanation once and every plugin picks it up on next build.

## [0.2.0] — 2026-05-16

### Added

- `ViewToolFs.readMany(paths: string[]): Promise<Array<Buffer | null>>` —
  batch read API. Position-correlated result array; null per path that
  could not be read (not-found / forbidden / transient). Backends MUST
  parallelize the underlying reads. Replaces the `for…await readFile`
  loop pattern that gave the remote MCP server's view-tools 20+s render
  latency on workspaces with ~100 action files.
- `ViewToolFs.listWithMeta(prefix: string): Promise<ListWithMetaEntry[]>` —
  list paths annotated with their YAML frontmatter. Lets view-tools
  push status / priority / date filtering into the storage layer so
  bodies are only fetched for entries the renderer is going to display.
  Returns sorted, ≤1000 entries (matches `list()`'s cap). `meta` is
  null for files without frontmatter or when extraction fails.
- `ListWithMetaEntry` — `{ path, meta }` type, exported from the
  package barrel.
- `extractFrontmatterMetadata(text: string): Record<string, unknown> | null` —
  plugin-agnostic YAML-frontmatter extractor used by both the S3-backed
  fs's blob_metadata cache (in the agntux/app remote MCP server) and
  the local-fs ViewToolContext's `listWithMeta`. Distinct from
  `parseFrontmatter`, which normalises to the agntux-core
  `ActionFrontmatter` shape.

### Notes

- `ViewToolFs` is now four-method (`readFile`, `readMany`, `list`,
  `listWithMeta`, `exists`). Downstream implementations of the
  interface MUST add the two new methods. The S3-backed
  implementation in `agntux/app`'s `lib/mcp/runtime/fs-s3.ts` is
  updated in lock-step; the `createLocalFsContext` factory in this
  package also implements both new methods.

## [0.1.0]

Initial private release. ViewToolContext contract, local-fs factory,
manifest schema, parse-action helpers.

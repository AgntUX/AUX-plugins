# Changelog

All notable changes to `@agntux/plugin-runtime` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

// =============================================================================
// FROZEN CONTRACT — Sub-plan 4 owns this surface.
//
// `ViewToolContext` is the cross-environment shim that lets a view-tool handler
// run BOTH on agntux-core's local MCP server (reading from a local agntux
// project root) AND on the remote `/api/mcp` route in app/ (reading from
// S3-backed `team_files` / `team_file_blobs`). Sub-plans 2, 3, and 5 all bind
// to the shapes declared in this file. Removing or renaming an existing field
// is a coordinated breaking change across four PRs. Adding a NEW optional
// field is backwards-compatible.
//
// The factory that produces a ViewToolContext lives in a per-environment
// module:
//   - `src/local-fs.ts`  → createLocalFsContext({ root, scope })
//   - `app/lib/mcp/runtime/index.ts` → createS3FsContext({ userId, organizationId })
//
// Trust-model invariant: handlers receive a ViewToolContext and nothing else.
// They cannot import `node:fs`, `fetch`, `process.env`, `child_process`.
// The compiled view-tool bundle external-izes `@agntux/plugin-runtime`, so the
// surface area is exactly: `ctx.fs`, `ctx.scope`, `ctx.now()`, `ctx.log()`,
// `ctx.withScope()`, plus the pure helpers re-exported from this package
// (parse-action, manifest-schema). See `src/index.ts` for the public barrel.
// =============================================================================

export type JsonSchema = Record<string, unknown>;

/**
 * Per-call scope. Sub-plan 2's dispatcher constructs the root context with
 * just `{ user_id, organization_id }` — `team_slug` and `leader_view_slug`
 * are narrowed by the handler itself via `ctx.withScope(...)` after it has
 * validated the relevant input arg.
 */
export interface ViewToolScope {
  user_id: string;
  organization_id: string;
  /** Set when the handler narrows scope to a team. */
  team_slug?: string;
  /** Set when the handler narrows scope to a leader-view. */
  leader_view_slug?: string;
}

/**
 * Filesystem-like read API. All methods take **paths relative to the agntux
 * project root** (local factory) or **paths relative to the container root**
 * (S3 factory). The S3 factory derives container_id from the path prefix via
 * `classifyPath` + DB resolution.
 *
 * Error contract — all methods may throw `ViewToolFsError` with one of four
 * codes:
 *   - `"not-found"` (404) — file or container does not exist
 *   - `"forbidden"` (403) — caller is not a member of the resolved container
 *   - `"transient"` (503) — recoverable I/O failure (S3 5xx, DB timeout)
 *   - `"schema"`    (500) — caller-detected schema/parse failure surfaced
 *                            up from a parse helper
 */
/**
 * A single entry in a `listWithMeta` response. `meta` is the YAML
 * frontmatter parsed out of the file at write time (S3 backend) or on
 * the fly (local-fs backend). `null` when the file has no frontmatter
 * or extraction failed.
 */
export interface ListWithMetaEntry {
  path: string;
  meta: Record<string, unknown> | null;
}

/**
 * Result of a successful write through `ViewToolFs.writeFile` / `update`.
 *
 * `seq` is the per-container sequence number assigned by the storage layer
 * after the write. The desktop daemon's pull loop fetches changes since
 * its last-seen `seq`, so emitting it here lets the SSE push channel
 * tell the daemon exactly which cursor to advance to without re-querying
 * the database.
 */
export interface WriteResult {
  /** Lowercase 64-hex sha256 of the new file body. */
  new_sha256: string;
  /** Per-container monotonic sequence number assigned to this write. */
  seq: number;
  /** Container the write landed in. */
  container_id: string;
}

/**
 * Input to `ViewToolFs.writeFile`. `parent_sha` is the CAS guard — the write
 * succeeds only if the file's current head matches. Pass `null` for
 * create-only (write fails if the file already exists). Omit (undefined)
 * for last-write-wins.
 */
export interface WriteFileOpts {
  /**
   * Lowercase 64-hex parent sha256 for CAS, `null` for create-only, or
   * `undefined` to skip CAS entirely (last-write-wins; not recommended).
   */
  parent_sha?: string | null;
}

/**
 * Patch function passed to `ViewToolFs.update`. Receives the current body
 * (or `null` when the file doesn't exist) and returns the new body. May be
 * called more than once if the CAS guard fails and the helper retries.
 */
export type UpdatePatch = (
  current: string | null,
) => string | Promise<string>;

export interface ViewToolFs {
  /** Read the file at `path`. Throws ViewToolFsError on any failure. */
  readFile(path: string): Promise<Buffer>;
  /**
   * Batch read of multiple files. Position-correlated to `paths`:
   * `result[i]` is the body of `paths[i]`, or `null` if that path
   * could not be read (not-found, forbidden, transient). Never throws
   * for a per-file failure — only for a backend-level error.
   *
   * Backends SHOULD parallelize the underlying reads (S3-backed
   * implementations are expected to fan out with a concurrency cap).
   * Callers MUST use `readMany` instead of a `for…await readFile`
   * loop whenever they need N files — N+1 read latency is the
   * single biggest cause of slow view-tool responses on the
   * remote MCP server.
   */
  readMany(paths: string[]): Promise<Array<Buffer | null>>;
  /** List paths whose prefix matches `prefix`. Returns sorted, ≤1000 entries. */
  list(prefix: string): Promise<string[]>;
  /**
   * List paths whose prefix matches `prefix`, each annotated with the
   * file's parsed YAML frontmatter. Use this to push status / priority /
   * date filtering into the storage layer — callers can drop entries
   * client-side using the returned `meta` and then `readMany` only
   * the bodies they actually need to render.
   *
   * Returns sorted, ≤1000 entries to match `list`'s cap. `meta` is
   * `null` for files without YAML frontmatter or for files whose
   * frontmatter could not be parsed.
   *
   * Backends MAY satisfy this from a server-side metadata index
   * (S3-backed implementations) or by reading + parsing each file
   * (local-fs). Either way, the contract is "no per-file body fetch
   * for entries the caller is going to discard".
   */
  listWithMeta(prefix: string): Promise<ListWithMetaEntry[]>;
  /** Cheap existence probe. Returns false on any not-found/forbidden. */
  exists(path: string): Promise<boolean>;
  /**
   * Write `body` to `path`. Atomic at the container level via the storage
   * layer's CAS protocol (Postgres `team_sync_push_entry` for the S3
   * backend; atomic-rename for the local-fs backend). The blob is uploaded
   * to S3 if its content-addressed sha is not already present.
   *
   * Throws `ViewToolFsError("conflict")` when `opts.parent_sha` is set and
   * the file's current head sha doesn't match — callers either retry via
   * `update()` (which re-reads + re-patches) or surface the conflict to
   * the user. Throws `ViewToolFsError("forbidden")` if the path resolves
   * to a container the caller cannot write to (same gate as reads).
   *
   * Returns the new content sha + the per-container seq the write landed
   * at. The S3 backend additionally publishes a push-notification event
   * on the seq advance so the desktop daemon pulls the new file
   * immediately rather than waiting for the next 5-min poll.
   */
  writeFile(
    path: string,
    body: Buffer | string,
    opts?: WriteFileOpts,
  ): Promise<WriteResult>;
  /**
   * Read-modify-write helper with bounded CAS retry. Reads the file's
   * current body (or `null` if absent), calls `patch` to produce the new
   * body, then writes through `writeFile` with the read-time parent sha.
   * On `conflict` errors, re-reads and retries up to 3 times with jittered
   * backoff before giving up.
   *
   * Use this for any mutation that depends on the file's current state
   * (appending a body section, merging a JSON patch, advancing a
   * frontmatter state machine). One-shot writes that don't read the
   * existing body SHOULD call `writeFile` directly.
   */
  update(path: string, patch: UpdatePatch): Promise<WriteResult>;
  /**
   * Tombstone a file. The S3 backend records a `deleted=true` entry in
   * `team_files` via the same `team_sync_push_entry` RPC; the local-fs
   * backend unlinks. Idempotent on already-deleted paths (returns the
   * current seq).
   */
  deleteFile(path: string, opts?: WriteFileOpts): Promise<WriteResult>;
}

/**
 * The cross-environment runtime context. Immutable: `withScope` returns a
 * NEW ViewToolContext with the merged scope; child contexts share the
 * parent's memoized auth gate so narrowing scope is free of extra DB
 * round-trips.
 */
export interface ViewToolContext {
  readonly fs: ViewToolFs;
  readonly scope: Readonly<ViewToolScope>;
  /** Returns the current time as a Date. Injected for deterministic tests. */
  now(): Date;
  /**
   * Structured log emitter. Implementations route to console / OpenTelemetry /
   * the host-passthrough channel. `fields` MUST be JSON-serializable.
   */
  log(
    level: "debug" | "info" | "warn" | "error",
    msg: string,
    fields?: Record<string, unknown>,
  ): void;
  /**
   * Narrow scope without re-running the per-context authorization gate.
   * Returns a NEW ViewToolContext; the original is unchanged.
   *
   *     const teamCtx = ctx.withScope({ team_slug: args.team_slug });
   *     await teamCtx.fs.readFile(`teams/${args.team_slug}/data/actions/x.md`);
   */
  withScope(extra: Partial<ViewToolScope>): ViewToolContext;
}

/**
 * Per-tool descriptor consumed by Sub-plan 3's registry. Mirrors the shape of
 * `view_tools[]` entries in the manifest, minus the build-time `mcp_app_meta`
 * field (that is pre-joined into the manifest layer).
 *
 * `data_paths` is OPTIONAL here: emit-manifest reads `vt.descriptor.data_paths`
 * and, when omitted, defaults it to `[{ pattern: "actions/{id}.md", scope:
 * "personal" }]` before writing the manifest (where it is REQUIRED). A plugin
 * whose action files don't follow that default glob SHOULD set `data_paths`
 * explicitly on the descriptor so the manifest carries the real pattern. The
 * field is additive — handlers that omit it keep the legacy default.
 */
export interface ViewToolDescriptor {
  /** Snake_case, plugin-prefixed. e.g. `agntux_core_triage`. */
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  /** `ui://<plugin-slug>/<component-name>` */
  ui_resource_uri: string;
  /**
   * Optional read/write glob(s) for this tool's backing files, mirroring the
   * manifest's `data_paths[]` shape (`scope` is one of "personal" | "team" |
   * "leader-view"). Omit to accept emit-manifest's `actions/{id}.md` personal
   * default; set explicitly when the plugin's files live elsewhere.
   */
  data_paths?: { pattern: string; scope: string }[];
}

/**
 * The handler-side surface every view tool exports. Plugin authors write the
 * `handle` function against the `(args, ctx)` signature; the compiled module
 * exports `default: { viewTools: ViewTool<any, any>[] }` per `ViewToolModule`.
 */
export interface ViewTool<Args, Out> {
  descriptor: ViewToolDescriptor;
  /**
   * Return shape: `{ content?, structuredContent }`.
   *
   * `structuredContent` is the data payload the host materializes into
   * the iframe (the user-visible surface). `content[]` is an optional
   * text channel forwarded to the chat model alongside the iframe —
   * use it to explain the MCP Apps lifecycle so the model knows the
   * iframe IS the result of its tool call and no follow-up commentary
   * or visualization is needed. Author the text via
   * `renderConfirmationText(uiLabel)` from this package so every
   * plugin shares the same wording (see render-confirmation.ts).
   *
   * Both success AND error branches should ship `content[]` — the
   * iframe renders both, so the "stop after rendering" framing applies
   * either way.
   *
   * Per MCP 2025-06-18 §tool-result, `content[]` and `structuredContent`
   * coexisting on a single CallToolResult is explicitly compliant.
   */
  handle(
    args: Args,
    ctx: ViewToolContext,
  ): Promise<{
    content?: Array<{ type: "text"; text: string }>;
    structuredContent: Out;
  }>;
}

/**
 * Per-mutation-tool descriptor. Narrower than `ViewToolDescriptor` —
 * mutation tools don't render UI, so they carry no `ui_resource_uri` or
 * `outputSchema`. The compiled handler module exports one entry per
 * declared mutation tool alongside view tools (`{ viewTools: [],
 * mutationTools: [] }`).
 */
export interface MutationToolDescriptor {
  /** Snake_case, plugin-prefixed. e.g. `agntux_core_dismiss`. */
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/**
 * Handler surface for a mutation tool. Returns either a small status
 * envelope (`{ content: [{type: "text", text: ...}] }`) or a structured
 * result — both are accepted by the remote server's dispatch. The
 * iframe usually ignores the return shape on success; the structured
 * form is useful when the mutation also needs to relay state back.
 */
export interface MutationTool<Args> {
  descriptor: MutationToolDescriptor;
  handle(
    args: Args,
    ctx: ViewToolContext,
  ): Promise<
    | { content: Array<{ type: "text"; text: string }> }
    | { structuredContent: unknown }
  >;
}

/**
 * Shape of the default export from a compiled view-tool module.
 *
 * Phase 3's `materialize.ts` and Phase 5's emit-manifest template both bind
 * to this type so any refactor (e.g. moving to `export const viewTools`)
 * breaks both consumers at compile time. See the master plan's "compiled-
 * module shape drift" risk entry.
 *
 * `mutationTools` is optional — only ingest plugins with write-back UI
 * flows declare it.
 */
export interface ViewToolModule {
  viewTools: ViewTool<unknown, unknown>[];
  mutationTools?: MutationTool<unknown>[];
}

export type ViewToolFsErrorCode =
  | "not-found"
  | "forbidden"
  | "transient"
  | "schema"
  | "conflict";

const STATUS_BY_CODE: Record<ViewToolFsErrorCode, number> = {
  "not-found": 404,
  forbidden: 403,
  transient: 503,
  schema: 500,
  // 409 Conflict — CAS guard failed: file's current head doesn't match the
  // supplied parent_sha. Callers using `update()` get automatic bounded
  // retry; raw `writeFile` callers must surface this to the user.
  conflict: 409,
};

/**
 * Uniform error shape across both fs factories. Sub-plan 2's `/api/mcp` route
 * maps this to a JSON-RPC error envelope on the way out:
 *   - `404` → `-32004` (resource not found)
 *   - `403` → `-32001` (forbidden)
 *   - `503` → `-32002` (transient — caller should retry)
 *   - `500` → `-32603` (internal error)
 *
 * Mirrors `BlobUploadError` / `ContainerLookupError` in `app/lib/sync/` so
 * app developers see one consistent error model.
 */
export class ViewToolFsError extends Error {
  readonly code: ViewToolFsErrorCode;
  readonly path: string;
  readonly status: number;
  constructor(code: ViewToolFsErrorCode, path: string, message?: string) {
    super(message ?? `${code}: ${path}`);
    this.name = "ViewToolFsError";
    this.code = code;
    this.path = path;
    this.status = STATUS_BY_CODE[code];
  }
}

/**
 * Helper used by both factories to enforce the immutability contract:
 * given a `scope` object plus an `extra` partial, return a fresh frozen
 * scope merging the two. The factory's `withScope` callers reuse this
 * to avoid drifting on the merge semantics.
 */
export function mergeScope(
  scope: Readonly<ViewToolScope>,
  extra: Partial<ViewToolScope>,
): Readonly<ViewToolScope> {
  return Object.freeze({
    ...scope,
    ...extra,
  });
}

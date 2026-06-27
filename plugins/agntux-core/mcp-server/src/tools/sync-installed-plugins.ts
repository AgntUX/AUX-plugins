// sync-installed-plugins — write the user's currently-installed plugin
// set to `~/.agntux/installed-plugins.json` so the agntux-teams Electron
// daemon can mirror it to the AgntUX server.
//
// Why this tool exists:
//   Claude Desktop's local plugin install state lives in
//   `installed_plugins.json`, in an Anthropic-controlled format that may
//   drift over time. The agntux-core skill is the canonical reader of
//   that file (it already enumerates plugins via the host's
//   `mcp__plugins__list_plugins` tool). Rather than duplicate the
//   parsing logic in the daemon and the server, the skill normalizes the
//   list and calls this tool to write a small, stable schema that the
//   daemon watches with chokidar and POSTs to `/api/me/plugins`. The
//   server then materializes view-tools for those plugins on the next
//   MCP session.
//
//   Home-scoped (not project-scoped) because the daemon is per-user, not
//   per-project. A user's installed-plugins set is the same whether
//   they're working in `~/agntux` or any other agntux root.
//
// Atomicity: write to a sibling .tmp file and rename. Mirrors the
// snooze / dismiss / triage-prefs pattern so a daemon process that
// crashes mid-write never leaves a half-written file for the watcher to
// read.

import {
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Matches the slug regex used elsewhere in agntux-core (scope.ts,
// triage-prefs.ts, set-status.ts — all `{0,62}` → 64-char max) and the
// canonical marketplace `PluginSlugRe` in
// AUX-plugins/lib/marketplace-schema.ts. Leading char is `[a-z]` (not
// `[a-z0-9]`) because every real plugin slug starts with a letter.
const SLUG_RE = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MARKETPLACE_RE = SLUG_RE;
const MAX_PLUGINS = 256;
const MAX_VERSION_LEN = 64;
const MAX_SHA_LEN = 128;

// The marketplace every first-party AgntUX plugin ships in. Used as the
// default when a caller passes a bare slug string or an entry that omits
// `marketplace` — the tool description and the agntux-core skill prompt
// both already promise "default marketplace to `agntux` when unknown", so
// the tool implements that contract instead of silently dropping the entry.
const DEFAULT_MARKETPLACE = "agntux";

// Upper bound on how many dropped entries we retain and render in an error/
// warning envelope. A pathological all-invalid input could otherwise build
// an unbounded message + `structuredContent.dropped` array (the valid set
// is already clamped to MAX_PLUGINS; the dropped set was not). We keep a
// sample of this many reasons plus a total count.
const MAX_REPORTED_DROPS = 25;

export interface InstalledPluginEntry {
  slug: string;
  marketplace: string;
  version?: string;
  source_sha?: string;
}

export interface InstalledPluginsFile {
  schema_version: 1;
  generated_at: string;
  plugins: InstalledPluginEntry[];
}

// Resolve the user's home directory. `AGNTUX_HOME_OVERRIDE` is a test
// seam — set it to a tmpdir to redirect the writes without depending on
// HOME env var overrides (vitest's runtime resolves `os.homedir()` via
// libuv's passwd-db lookup, ignoring HOME, so an env-var override at
// the homedir() boundary wouldn't work in tests).
function resolveHomeRoot(): string {
  return process.env.AGNTUX_HOME_OVERRIDE ?? homedir();
}

function installedPluginsPath(): string {
  return join(resolveHomeRoot(), ".agntux", "installed-plugins.json");
}

function installedPluginsDir(): string {
  return join(resolveHomeRoot(), ".agntux");
}

interface DroppedEntry {
  value: unknown;
  reason: string;
}

// A short, safe rendering of an arbitrary caller-supplied value for
// inclusion in a drop-reason message. Truncated so a pathological entry
// can't bloat the error envelope.
function describeValue(value: unknown): string {
  let s: string;
  try {
    const json = JSON.stringify(value);
    s = json === undefined ? String(value) : json;
  } catch {
    s = String(value);
  }
  return s.length > 120 ? s.slice(0, 117) + "..." : s;
}

// Normalize a single caller entry into either a valid entry or a drop
// reason. Accepts a bare slug string (marketplace defaults to `agntux`)
// or an object. A missing/empty `marketplace` defaults to `agntux` — but
// an explicitly-provided value that fails the format is a real caller
// error and is reported, never silently coerced.
function sanitizeEntry(
  raw: unknown,
): { entry: InstalledPluginEntry } | { reason: string } {
  if (typeof raw === "string") {
    const slug = raw.trim();
    if (!SLUG_RE.test(slug)) {
      return { reason: `bare slug ${describeValue(raw)} is not a valid plugin slug` };
    }
    return { entry: { slug, marketplace: DEFAULT_MARKETPLACE } };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      reason: `entry ${describeValue(raw)} is neither an object nor a slug string`,
    };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.slug !== "string") {
    return { reason: `entry ${describeValue(raw)} is missing a string \`slug\`` };
  }
  const slug = obj.slug.trim();
  if (!SLUG_RE.test(slug)) {
    return { reason: `slug ${describeValue(obj.slug)} is not a valid plugin slug` };
  }
  // Default a missing/empty marketplace to `agntux` (the documented
  // default). A provided-but-malformed marketplace is a caller error.
  let marketplace = DEFAULT_MARKETPLACE;
  if (typeof obj.marketplace === "string" && obj.marketplace.trim().length > 0) {
    marketplace = obj.marketplace.trim();
    if (!MARKETPLACE_RE.test(marketplace)) {
      return {
        reason: `marketplace ${describeValue(obj.marketplace)} (for slug \`${slug}\`) is not a valid marketplace name`,
      };
    }
  }
  const out: InstalledPluginEntry = { slug, marketplace };
  if (typeof obj.version === "string") {
    const v = obj.version.trim();
    if (v.length > 0 && v.length <= MAX_VERSION_LEN) out.version = v;
  }
  if (typeof obj.source_sha === "string") {
    const s = obj.source_sha.trim();
    if (s.length > 0 && s.length <= MAX_SHA_LEN) out.source_sha = s;
  }
  return { entry: out };
}

// Sanitize a caller-supplied array into the valid entry set plus the list
// of dropped entries (with reasons). Deduped by slug (first wins);
// duplicates are skipped silently (not a caller error). Clamped to
// MAX_PLUGINS.
function sanitizePlugins(raw: unknown[]): {
  plugins: InstalledPluginEntry[];
  dropped: DroppedEntry[]; // capped sample (<= MAX_REPORTED_DROPS) for reporting
  droppedCount: number; // total dropped, may exceed dropped.length
} {
  const seen = new Set<string>();
  const out: InstalledPluginEntry[] = [];
  const dropped: DroppedEntry[] = [];
  let droppedCount = 0;
  for (const item of raw) {
    const result = sanitizeEntry(item);
    if ("reason" in result) {
      droppedCount++;
      if (dropped.length < MAX_REPORTED_DROPS) {
        dropped.push({ value: item, reason: result.reason });
      }
      continue;
    }
    const entry = result.entry;
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    out.push(entry);
    if (out.length >= MAX_PLUGINS) break;
  }
  return { plugins: out, dropped, droppedCount };
}

// Render a bounded, human-readable list of drop reasons from the capped
// sample, appending a "+N more" line when the total exceeds the sample.
function formatDropped(dropped: DroppedEntry[], droppedCount: number): string {
  const lines = dropped.map((d) => `  - ${describeValue(d.value)}: ${d.reason}`);
  if (droppedCount > dropped.length) {
    lines.push(`  …and ${droppedCount - dropped.length} more`);
  }
  return lines.join("\n");
}

// agntux-core is self-evidently installed whenever this tool is callable
// — the tool only exists because agntux-core's MCP server is running. The
// skill's first-run onboarding pass historically synced only the
// user-confirmed *ingest* plugins (agntux-slack / agntux-gmail), which
// silently dropped the hub from the manifest, and with it every
// agntux-core view-tool the remote MCP connector would otherwise expose.
// Whenever a NON-EMPTY plugin set is written, guarantee the hub is in it
// regardless of what the caller passes. Scope is the hub ONLY:
// agntux-build runs a separate local MCP server and is not always
// installed, so it is never force-injected here — it is registered via
// the skill's host enumeration when actually present.
//
// Why we do NOT floor an EMPTY set: an empty set here means the caller
// deliberately synced "nothing" — an absent arg or an explicit `[]` (a
// transient host enumeration that returned zero). (A non-empty arg that
// sanitizes to zero is a malformed call and is rejected in the handler
// BEFORE this floor runs, so it never reaches here.) The server's
// reconciliation endpoint treats a zero-length snapshot as a safe no-op
// (it does NOT soft-delete the existing per-user ledger). Flooring an
// empty set to `[agntux-core]` would turn that no-op into a 1-entry
// snapshot that reconciles and removes every OTHER plugin's view-tools.
// The floor's job is to stop the hub being dropped while a real plugin
// set is written — not to manufacture a snapshot out of nothing.
const CORE_SLUG = "agntux-core";
const CORE_MARKETPLACE = "agntux";

function ensureCorePresent(
  plugins: InstalledPluginEntry[],
): InstalledPluginEntry[] {
  if (plugins.length === 0) return plugins;
  if (plugins.some((p) => p.slug === CORE_SLUG)) return plugins;
  // Prepend the hub, then re-apply the MAX_PLUGINS clamp so a saturated
  // 256-entry list can never push the floor back out.
  return [
    { slug: CORE_SLUG, marketplace: CORE_MARKETPLACE },
    ...plugins,
  ].slice(0, MAX_PLUGINS);
}

function writeInstalledPluginsFile(file: InstalledPluginsFile): string {
  const dir = installedPluginsDir();
  const path = installedPluginsPath();
  mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(file, null, 2) + "\n";
  const tmp = path + ".tmp";
  writeFileSync(tmp, body, { mode: 0o644 });
  renameSync(tmp, path);
  return path;
}

export const syncInstalledPluginsTool = {
  description:
    "Persist the user's currently-installed Claude plugin set to `~/.agntux/installed-plugins.json`. Called by the agntux-core skill after it enumerates plugins via the host's `mcp__plugins__list_plugins` tool. The agntux-teams daemon watches this file with chokidar and POSTs the snapshot to the AgntUX server; the server uses the per-user install ledger to know which plugins' view-tools to expose on the remote MCP connector. REPLACES the file's `plugins[]` array atomically — pass the COMPLETE enumerated list, not a patch. Whenever a non-empty set is written, `agntux-core` is included even if omitted from the call (it is self-evidently installed whenever this tool runs), so the hub's own view-tools are never accidentally dropped. An empty list is left empty — a deliberate no-op snapshot. Each entry may be `{ slug, marketplace }` or a bare slug string; a missing `marketplace` defaults to `agntux`. If a non-empty call contains NO valid entries (all malformed) the tool returns an error and writes NOTHING rather than clobbering the manifest to empty — fix the entry shape and retry.",
  inputSchema: {
    type: "object" as const,
    properties: {
      plugins: {
        type: "array",
        description:
          "Complete list of installed plugins. Each entry must include `slug` and `marketplace`. Optional `version` (the version string from the plugin's plugin.json) and `source_sha` (the GitHub commit SHA the plugin was pinned at, when known).",
        items: {
          type: "object",
          properties: {
            slug: { type: "string" },
            marketplace: { type: "string" },
            version: { type: "string" },
            source_sha: { type: "string" },
          },
          required: ["slug", "marketplace"],
        },
      },
    },
    required: ["plugins"],
  },
  async handler(args: Record<string, unknown>) {
    let rawArg: unknown = args.plugins;

    // Tolerate a JSON-stringified array — a common model encoding that the
    // old code silently coerced to an empty write.
    if (typeof rawArg === "string") {
      try {
        rawArg = JSON.parse(rawArg);
      } catch {
        // leave as the original string — flagged as malformed below
      }
    }

    // Deliberate no-op: arg absent/null, or an explicitly empty array. Write
    // the empty snapshot — the server treats a zero-length snapshot as a safe
    // no-op (it does NOT soft-delete the per-user ledger), and we never floor
    // an empty set to `[agntux-core]` (that would reconcile away every other
    // plugin's view-tools).
    const isEmptyNoop =
      rawArg === undefined ||
      rawArg === null ||
      (Array.isArray(rawArg) && rawArg.length === 0);
    if (isEmptyNoop) {
      const file: InstalledPluginsFile = {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        plugins: [],
      };
      const path = writeInstalledPluginsFile(file);
      return {
        content: [
          {
            type: "text" as const,
            text: `installed-plugins.json saved (0 plugin(s)) at ${path}`,
          },
        ],
        structuredContent: { ok: true, written: true, path, plugin_count: 0 },
      };
    }

    // Caller intended to sync something but it isn't an array — e.g. an
    // object, a number, or an unparseable string. Fail loud, write nothing.
    if (!Array.isArray(rawArg)) {
      const text =
        `agntux_core_sync_installed_plugins: the \`plugins\` argument must be an array ` +
        `(got ${describeValue(rawArg)}), so the manifest was NOT written — your existing ` +
        `~/.agntux/installed-plugins.json is unchanged.\n\n` +
        `Pass an array of { slug, marketplace } objects (marketplace defaults to "agntux" ` +
        `if omitted), or bare slug strings. Example:\n` +
        `  { "plugins": [ { "slug": "agntux-core", "marketplace": "agntux" }, { "slug": "agntux-slack" } ] }`;
      return {
        isError: true,
        content: [{ type: "text" as const, text }],
        structuredContent: { ok: false, written: false, valid: 0 },
      };
    }

    const { plugins: sanitized, dropped, droppedCount } =
      sanitizePlugins(rawArg);

    // Non-empty input that produced zero valid entries — the field-reported
    // bug class (bare slugs / wrong shape silently became `plugins: []`).
    // Fail loud and write NOTHING so a previously-good manifest isn't
    // clobbered and the caller can retry with the corrected shape.
    if (sanitized.length === 0) {
      const text =
        `agntux_core_sync_installed_plugins: received ${rawArg.length} plugin item(s) but ` +
        `NONE were valid, so the manifest was NOT written — your existing ` +
        `~/.agntux/installed-plugins.json is unchanged.\n\n` +
        `Each entry must be { slug, marketplace } (marketplace defaults to "agntux" if ` +
        `omitted) or a bare slug string. Dropped entries:\n` +
        `${formatDropped(dropped, droppedCount)}\n\n` +
        `Retry with the corrected shape, e.g.:\n` +
        `  { "plugins": [ { "slug": "agntux-core", "marketplace": "agntux" }, { "slug": "agntux-slack" } ] }`;
      return {
        isError: true,
        content: [{ type: "text" as const, text }],
        structuredContent: {
          ok: false,
          written: false,
          received: rawArg.length,
          valid: 0,
          dropped_count: droppedCount,
          dropped: dropped.map((d) => d.reason),
        },
      };
    }

    const plugins = ensureCorePresent(sanitized);
    const file: InstalledPluginsFile = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      plugins,
    };
    const path = writeInstalledPluginsFile(file);

    let text = `installed-plugins.json saved (${plugins.length} plugin(s)) at ${path}`;
    if (droppedCount > 0) {
      text +=
        `\n\nWARNING: ${droppedCount} entr${droppedCount === 1 ? "y was" : "ies were"} ` +
        `dropped and NOT included:\n${formatDropped(dropped, droppedCount)}`;
    }

    return {
      content: [{ type: "text" as const, text }],
      structuredContent: {
        ok: true,
        written: true,
        path,
        plugin_count: plugins.length,
        ...(droppedCount > 0
          ? { dropped_count: droppedCount, dropped: dropped.map((d) => d.reason) }
          : {}),
      },
    };
  },
};

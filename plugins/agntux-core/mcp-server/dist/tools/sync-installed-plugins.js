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
import { mkdirSync, renameSync, writeFileSync, } from "node:fs";
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
// Resolve the user's home directory. `AGNTUX_HOME_OVERRIDE` is a test
// seam — set it to a tmpdir to redirect the writes without depending on
// HOME env var overrides (vitest's runtime resolves `os.homedir()` via
// libuv's passwd-db lookup, ignoring HOME, so an env-var override at
// the homedir() boundary wouldn't work in tests).
function resolveHomeRoot() {
    return process.env.AGNTUX_HOME_OVERRIDE ?? homedir();
}
function installedPluginsPath() {
    return join(resolveHomeRoot(), ".agntux", "installed-plugins.json");
}
function installedPluginsDir() {
    return join(resolveHomeRoot(), ".agntux");
}
function sanitizeEntry(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const obj = raw;
    if (typeof obj.slug !== "string")
        return null;
    if (typeof obj.marketplace !== "string")
        return null;
    const slug = obj.slug.trim();
    const marketplace = obj.marketplace.trim();
    if (!SLUG_RE.test(slug))
        return null;
    if (!MARKETPLACE_RE.test(marketplace))
        return null;
    const out = { slug, marketplace };
    if (typeof obj.version === "string") {
        const v = obj.version.trim();
        if (v.length > 0 && v.length <= MAX_VERSION_LEN)
            out.version = v;
    }
    if (typeof obj.source_sha === "string") {
        const s = obj.source_sha.trim();
        if (s.length > 0 && s.length <= MAX_SHA_LEN)
            out.source_sha = s;
    }
    return out;
}
function sanitizePlugins(raw) {
    if (!Array.isArray(raw))
        return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const entry = sanitizeEntry(item);
        if (!entry)
            continue;
        if (seen.has(entry.slug))
            continue;
        seen.add(entry.slug);
        out.push(entry);
        if (out.length >= MAX_PLUGINS)
            break;
    }
    return out;
}
function writeInstalledPluginsFile(file) {
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
    description: "Persist the user's currently-installed Claude plugin set to `~/.agntux/installed-plugins.json`. Called by the agntux-core skill after it enumerates plugins via the host's `mcp__plugins__list_plugins` tool. The agntux-teams daemon watches this file with chokidar and POSTs the snapshot to the AgntUX server; the server uses the per-user install ledger to know which plugins' view-tools to expose on the remote MCP connector. REPLACES the file's `plugins[]` array atomically — pass the COMPLETE enumerated list, not a patch.",
    inputSchema: {
        type: "object",
        properties: {
            plugins: {
                type: "array",
                description: "Complete list of installed plugins. Each entry must include `slug` and `marketplace`. Optional `version` (the version string from the plugin's plugin.json) and `source_sha` (the GitHub commit SHA the plugin was pinned at, when known).",
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
    async handler(args) {
        const plugins = sanitizePlugins(args.plugins);
        const file = {
            schema_version: 1,
            generated_at: new Date().toISOString(),
            plugins,
        };
        const path = writeInstalledPluginsFile(file);
        return {
            content: [
                {
                    type: "text",
                    text: `installed-plugins.json saved (${plugins.length} plugin(s)) at ${path}`,
                },
            ],
            structuredContent: {
                ok: true,
                path,
                plugin_count: plugins.length,
            },
        };
    },
};

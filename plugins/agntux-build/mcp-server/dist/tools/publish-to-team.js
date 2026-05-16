/**
 * agntux_build_publish_to_team — S3.3 / P3 team-publish RPC.
 *
 * Walks the built plugin directory, packs every file into a base64-encoded
 * manifest, reads the license JWT from `<agntux project root>/.agntux/
 * teams.json`, and POSTs to the backend's team-private marketplace publish
 * endpoint. The backend owns commit, audit, and DCO re-validation; this tool
 * is a thin RPC + manifest builder.
 *
 * Tool-vs-skill rule (per P3 § "Tool-vs-skill discipline"): this is a
 * category (c) external-API call. The expensive parts — reading the plugin
 * tree off disk and HTTP POST — are I/O the LLM can't do directly. The
 * tool has zero business logic: no schema decisions, no commit-message
 * synthesis, no auth choices.
 *
 * Inputs (per P3 § 4 "New MCP tool"):
 *   team_slug, org_slug, plugin_slug, plugin_version, tarball_path,
 *   contributor: { name, email }, dco_text_version
 *
 * Additionally accepts (S3.3 extension; the build skill knows both):
 *   agntux_root  — agntux project root (where .agntux/teams.json lives)
 *   plugin_dir   — directory of the unzipped plugin tree to publish
 *
 * Returns:
 *   { ok: true; submitted_at: string; plugin_slug; plugin_version; team_slug }
 *   { ok: false; error: string; reason: "auth" | "validation" | "conflict" | "network" }
 */
import { promises as fs, readFileSync, statSync, readdirSync, } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
// Public-plugin invariant (P3 + P11 cross-plugin contract): the
// `agntux-build` MCP server reads `license_jwt` as an OPAQUE Bearer
// pass-through only. No JWT decode, no claim inspection, no
// subscription_status / exp / tier checks at the LLM layer. The
// `agntux-teams` skill body owns the freshness gate (`_lib.md` preflight,
// per P11 §"Validation in agntux-teams preflight") and the backend owns
// the hard-gate Ed25519 verify at
// `/api/teams/{org_slug}/marketplace/publish`. Any client-side claim
// decode here would (a) re-introduce the "free for individuals" footgun
// the cross-plugin contract exists to prevent and (b) trip the
// regression sweep in
// `canonical/teams/agntux-teams/__tests__/license-preflight.test.mjs`
// ("agntux-build's mcp-server src never decodes JWT claims").
const DEFAULT_API_BASE = "https://app.agntux.ai";
const MAX_FILES = 1000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Walk a directory and return every file path relative to dir. Sorted for
 *  determinism. Excludes node_modules, dist, and any dot-directory at the
 *  plugin root so build artifacts and the host-renderer's local node_modules
 *  never leak into the published tree. */
export function walkPluginDir(dir) {
    const out = [];
    const skipDirs = new Set(["node_modules", "dist", ".git", ".omc"]);
    function walk(current) {
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        }
        catch (err) {
            throw new Error(`cannot read ${current}: ${err instanceof Error ? err.message : String(err)}`);
        }
        for (const entry of entries) {
            const name = String(entry.name);
            const full = join(current, name);
            if (entry.isDirectory()) {
                if (skipDirs.has(name))
                    continue;
                walk(full);
            }
            else if (entry.isFile()) {
                const rel = relative(dir, full).split(sep).join("/");
                out.push(rel);
            }
        }
    }
    walk(dir);
    out.sort();
    return out;
}
/** Build a base64 manifest of the plugin tree. Reads each file
 *  synchronously — the plugin tree is small (< MAX_FILES files) and the
 *  MCP call runs in its own short-lived process. */
export function buildManifest(pluginDir) {
    const paths = walkPluginDir(pluginDir);
    if (paths.length === 0) {
        throw new Error(`plugin_dir is empty: ${pluginDir}`);
    }
    if (paths.length > MAX_FILES) {
        throw new Error(`too many files (${paths.length} > ${MAX_FILES})`);
    }
    return paths.map((rel) => {
        const full = join(pluginDir, rel);
        const stat = statSync(full);
        if (stat.size > MAX_FILE_BYTES) {
            throw new Error(`${rel} exceeds per-file limit (${MAX_FILE_BYTES} bytes)`);
        }
        const buf = readFileSync(full);
        return { path: rel, content_base64: buf.toString("base64") };
    });
}
/** Read the license JWT from `<agntux_root>/.agntux/teams.json`. Throws an
 *  Error tagged with `reason: "auth"` semantics when the file is missing or
 *  the JWT is absent; the handler converts that to a structured response. */
export async function readLicenseJwt(agntuxRoot) {
    const path = join(agntuxRoot, ".agntux", "teams.json");
    let raw;
    try {
        raw = await fs.readFile(path, "utf8");
    }
    catch {
        throw new PublishError("auth", `teams.json not found at ${path} — run /agntux-teams onboard:* first`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new PublishError("auth", "teams.json is not valid JSON");
    }
    if (!parsed.license_jwt || typeof parsed.license_jwt !== "string") {
        throw new PublishError("auth", "teams.json is missing license_jwt — sign in to the AgntUX desktop app to refresh");
    }
    return parsed.license_jwt;
}
export class PublishError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = "PublishError";
    }
}
function validateInput(input) {
    const required = [
        "team_slug",
        "org_slug",
        "plugin_slug",
        "plugin_version",
        "agntux_root",
        "plugin_dir",
        "dco_text_version",
    ];
    for (const key of required) {
        if (typeof input[key] !== "string" || input[key].length === 0) {
            throw new PublishError("validation", `${key} is required`);
        }
    }
    if (!input.contributor ||
        typeof input.contributor.name !== "string" ||
        typeof input.contributor.email !== "string") {
        throw new PublishError("validation", "contributor.{name,email} are required");
    }
    if (input.dco_text_version !== "1.1") {
        throw new PublishError("validation", "dco_text_version must be '1.1'");
    }
    // The build flow may zip from a temp path that lives outside the agntux
    // root, so we don't enforce a containment check between plugin_dir and
    // agntux_root — path traversal inside the manifest is caught by the
    // backend's per-file `..` validation. We do confirm plugin_dir exists.
    const resolvedDir = resolve(input.plugin_dir);
    try {
        const stat = statSync(resolvedDir);
        if (!stat.isDirectory()) {
            throw new PublishError("validation", `plugin_dir is not a directory: ${resolvedDir}`);
        }
    }
    catch (err) {
        if (err instanceof PublishError)
            throw err;
        throw new PublishError("validation", `plugin_dir not found: ${resolvedDir}`);
    }
}
/** Pure handler — exported for unit tests. The MCP server's CallTool
 *  request handler wraps this and shapes the response into the MCP
 *  `content` envelope. */
export async function publishToTeam(input, opts = {}) {
    try {
        validateInput(input);
        const licenseJwt = await readLicenseJwt(input.agntux_root);
        // No client-side JWT decoding — the public-plugin invariant
        // (documented above on `TeamsJson`) keeps `license_jwt` opaque here.
        // Stale / lapsed JWTs are caught upstream by `agntux-teams`'
        // `_lib.md` preflight (LLM-layer soft-gate) and downstream by the
        // backend's Ed25519 verify (hard-gate). The fast-fail UX is the
        // skill-layer preflight, not this tool.
        const files = buildManifest(input.plugin_dir);
        const apiBase = opts.apiBase ?? process.env.AGNTUX_API_URL ?? DEFAULT_API_BASE;
        const url = `${apiBase.replace(/\/+$/, "")}/api/teams/${encodeURIComponent(input.org_slug)}/marketplace/publish`;
        const fetchImpl = opts.fetchImpl ?? fetch;
        let res;
        try {
            res = await fetchImpl(url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${licenseJwt}`,
                },
                body: JSON.stringify({
                    team_slug: input.team_slug,
                    plugin_slug: input.plugin_slug,
                    plugin_version: input.plugin_version,
                    contributor: input.contributor,
                    dco_text_version: input.dco_text_version,
                    tarball_path: input.tarball_path,
                    files,
                }),
            });
        }
        catch (err) {
            return {
                ok: false,
                reason: "network",
                error: err instanceof Error ? err.message : String(err),
            };
        }
        let body;
        try {
            body = await res.json();
        }
        catch {
            return {
                ok: false,
                reason: "network",
                error: `Backend returned non-JSON response (HTTP ${res.status})`,
            };
        }
        if (!res.ok) {
            const b = body;
            return {
                ok: false,
                reason: b.reason ?? "network",
                error: b.error ?? `HTTP ${res.status}`,
            };
        }
        const b = body;
        return {
            ok: true,
            submitted_at: b.submitted_at ?? new Date().toISOString(),
            plugin_slug: input.plugin_slug,
            plugin_version: input.plugin_version,
            team_slug: input.team_slug,
        };
    }
    catch (err) {
        if (err instanceof PublishError) {
            return { ok: false, reason: err.reason, error: err.message };
        }
        return {
            ok: false,
            reason: "validation",
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
export const publishToTeamTool = {
    name: "agntux_build_publish_to_team",
    description: "Publish a built AgntUX plugin to a team's private marketplace. Reads the license JWT from teams.json, walks the plugin directory, and POSTs the manifest to the AgntUX backend. Returns a non-technical success record (no GitHub URL); on failure returns a structured reason the build skill can react to.",
    inputSchema: {
        type: "object",
        properties: {
            team_slug: { type: "string" },
            org_slug: { type: "string" },
            plugin_slug: { type: "string" },
            plugin_version: { type: "string", description: "Semver string" },
            tarball_path: {
                type: "string",
                description: "Local path to the zipped plugin tree. Stored in the audit row; not opened by this tool.",
            },
            plugin_dir: {
                type: "string",
                description: "Local path to the unzipped plugin tree (the build_path). Walked to build the publish manifest.",
            },
            agntux_root: {
                type: "string",
                description: "Absolute path to the AgntUX project root (where .agntux/teams.json lives).",
            },
            contributor: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    email: { type: "string" },
                },
                required: ["name", "email"],
            },
            dco_text_version: {
                type: "string",
                description: "DCO version the contributor agreed to. Must be '1.1'.",
            },
        },
        required: [
            "team_slug",
            "org_slug",
            "plugin_slug",
            "plugin_version",
            "tarball_path",
            "plugin_dir",
            "agntux_root",
            "contributor",
            "dco_text_version",
        ],
    },
    async handler(args) {
        const result = await publishToTeam(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
            isError: !result.ok,
        };
    },
};

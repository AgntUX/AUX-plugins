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
export type PublishToTeamInput = {
    team_slug: string;
    org_slug: string;
    plugin_slug: string;
    plugin_version: string;
    tarball_path: string;
    contributor: {
        name: string;
        email: string;
    };
    dco_text_version: string;
    agntux_root: string;
    plugin_dir: string;
};
export type PublishToTeamOk = {
    ok: true;
    submitted_at: string;
    plugin_slug: string;
    plugin_version: string;
    team_slug: string;
};
export type PublishToTeamErr = {
    ok: false;
    error: string;
    reason: "auth" | "validation" | "conflict" | "network";
};
export type PublishToTeamResult = PublishToTeamOk | PublishToTeamErr;
/** Walk a directory and return every file path relative to dir. Sorted for
 *  determinism. Excludes node_modules, dist, and any dot-directory at the
 *  plugin root so build artifacts and the host-renderer's local node_modules
 *  never leak into the published tree. */
export declare function walkPluginDir(dir: string): string[];
/** Build a base64 manifest of the plugin tree. Reads each file
 *  synchronously — the plugin tree is small (< MAX_FILES files) and the
 *  MCP call runs in its own short-lived process. */
export declare function buildManifest(pluginDir: string): Array<{
    path: string;
    content_base64: string;
}>;
/** Read the license JWT from `<agntux_root>/.agntux/teams.json`. Throws an
 *  Error tagged with `reason: "auth"` semantics when the file is missing or
 *  the JWT is absent; the handler converts that to a structured response. */
export declare function readLicenseJwt(agntuxRoot: string): Promise<string>;
export declare class PublishError extends Error {
    reason: PublishToTeamErr["reason"];
    constructor(reason: PublishToTeamErr["reason"], message: string);
}
/** Pure handler — exported for unit tests. The MCP server's CallTool
 *  request handler wraps this and shapes the response into the MCP
 *  `content` envelope. */
export declare function publishToTeam(input: PublishToTeamInput, opts?: {
    fetchImpl?: typeof fetch;
    apiBase?: string;
}): Promise<PublishToTeamResult>;
export declare const publishToTeamTool: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            team_slug: {
                type: string;
            };
            org_slug: {
                type: string;
            };
            plugin_slug: {
                type: string;
            };
            plugin_version: {
                type: string;
                description: string;
            };
            tarball_path: {
                type: string;
                description: string;
            };
            plugin_dir: {
                type: string;
                description: string;
            };
            agntux_root: {
                type: string;
                description: string;
            };
            contributor: {
                type: string;
                properties: {
                    name: {
                        type: string;
                    };
                    email: {
                        type: string;
                    };
                };
                required: string[];
            };
            dco_text_version: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    handler(args: Record<string, unknown>): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        structuredContent: PublishToTeamResult;
        isError: boolean;
    }>;
};

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

import {
  promises as fs,
  readFileSync,
  statSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export type PublishToTeamInput = {
  team_slug: string;
  org_slug: string;
  plugin_slug: string;
  plugin_version: string;
  tarball_path: string;
  contributor: { name: string; email: string };
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

type TeamsJson = {
  license_jwt?: string;
  memberships?: Array<{ team_slug: string; org_slug?: string }>;
};

type LicenseJwtClaims = {
  exp?: number;
  iat?: number;
  org_slug?: string;
  tier?: string;
  subscription_status?: string;
  valid_for_team_slugs?: string[];
};

/** Subscription states under which client-side publish should attempt the
 *  POST. `canceled`, `canceled_locked`, `incomplete`, and legacy `lapsed`
 *  are rejected here so the user gets an actionable error without paying
 *  a network round-trip. The server runs the same check with full crypto
 *  verification — this is fast-fail UX, not the security gate. */
const CLIENT_ALLOWED_STATUSES: ReadonlySet<string> = new Set([
  "trialing",
  "active",
  "lapse_grace",
]);

/** Decode a JWT payload without signature verification — the client side
 *  of an MCP tool has no KMS access and cannot crypto-verify. The server
 *  is the security boundary; this decode is purely a UX fast-fail so we
 *  don't make the user wait on a network round-trip when the cached JWT
 *  is clearly expired or shaped for a different audience. */
export function decodeLicenseClaims(jwt: string): LicenseJwtClaims | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    return JSON.parse(payload) as LicenseJwtClaims;
  } catch {
    return null;
  }
}

/** Local (client-side) preflight of the cached license JWT. Returns null
 *  on success, or a PublishError on any failure. Failures here always
 *  carry `reason: "auth"` and a message pointing the user at how to
 *  recover ("subscription required" + how-to-refresh hint).
 *
 *  We deliberately do NOT verify the signature — the JWT is opaque to
 *  this tool. The backend re-runs every check with full Ed25519
 *  verification (see `verifyLicenseJwt` in app/lib/license/jwt.ts). */
export function preflightLicenseJwt(
  jwt: string,
  input: { org_slug: string; team_slug: string },
  nowSeconds: number = Math.floor(Date.now() / 1000)
): PublishError | null {
  const claims = decodeLicenseClaims(jwt);
  if (!claims) {
    return new PublishError(
      "auth",
      "subscription required — license JWT is malformed; sign in to the AgntUX desktop app to refresh"
    );
  }
  if (typeof claims.exp !== "number" || claims.exp < nowSeconds) {
    return new PublishError(
      "auth",
      "subscription required — license JWT is expired; sign in to the AgntUX desktop app to refresh"
    );
  }
  if (claims.tier !== "team") {
    return new PublishError(
      "auth",
      "subscription required — license JWT is not a team-tier token"
    );
  }
  if (
    typeof claims.subscription_status !== "string" ||
    !CLIENT_ALLOWED_STATUSES.has(claims.subscription_status)
  ) {
    return new PublishError(
      "auth",
      `subscription required — current state '${claims.subscription_status ?? "unknown"}' does not allow team publish; ask your admin to update billing`
    );
  }
  if (claims.org_slug && claims.org_slug !== input.org_slug) {
    return new PublishError(
      "auth",
      `subscription required — license JWT authorizes org '${claims.org_slug}', not '${input.org_slug}'`
    );
  }
  if (
    Array.isArray(claims.valid_for_team_slugs) &&
    !claims.valid_for_team_slugs.includes(input.team_slug)
  ) {
    return new PublishError(
      "auth",
      `subscription required — license JWT does not grant publish to team '${input.team_slug}'`
    );
  }
  return null;
}

const DEFAULT_API_BASE = "https://app.agntux.ai";
const MAX_FILES = 1000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Walk a directory and return every file path relative to dir. Sorted for
 *  determinism. Excludes node_modules, dist, and any dot-directory at the
 *  plugin root so build artifacts and the host-renderer's local node_modules
 *  never leak into the published tree. */
export function walkPluginDir(dir: string): string[] {
  const out: string[] = [];
  const skipDirs = new Set(["node_modules", "dist", ".git", ".omc"]);

  function walk(current: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true }) as Dirent[];
    } catch (err) {
      throw new Error(
        `cannot read ${current}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    for (const entry of entries) {
      const name = String(entry.name);
      const full = join(current, name);
      if (entry.isDirectory()) {
        if (skipDirs.has(name)) continue;
        walk(full);
      } else if (entry.isFile()) {
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
export function buildManifest(
  pluginDir: string
): Array<{ path: string; content_base64: string }> {
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
export async function readLicenseJwt(agntuxRoot: string): Promise<string> {
  const path = join(agntuxRoot, ".agntux", "teams.json");
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch {
    throw new PublishError(
      "auth",
      `teams.json not found at ${path} — run /agntux-teams onboard:* first`
    );
  }
  let parsed: TeamsJson;
  try {
    parsed = JSON.parse(raw) as TeamsJson;
  } catch {
    throw new PublishError("auth", "teams.json is not valid JSON");
  }
  if (!parsed.license_jwt || typeof parsed.license_jwt !== "string") {
    throw new PublishError(
      "auth",
      "teams.json is missing license_jwt — sign in to the AgntUX desktop app to refresh"
    );
  }
  return parsed.license_jwt;
}

export class PublishError extends Error {
  constructor(public reason: PublishToTeamErr["reason"], message: string) {
    super(message);
    this.name = "PublishError";
  }
}

function validateInput(input: PublishToTeamInput): void {
  const required: Array<keyof PublishToTeamInput> = [
    "team_slug",
    "org_slug",
    "plugin_slug",
    "plugin_version",
    "agntux_root",
    "plugin_dir",
    "dco_text_version",
  ];
  for (const key of required) {
    if (typeof input[key] !== "string" || (input[key] as string).length === 0) {
      throw new PublishError("validation", `${key} is required`);
    }
  }
  if (
    !input.contributor ||
    typeof input.contributor.name !== "string" ||
    typeof input.contributor.email !== "string"
  ) {
    throw new PublishError(
      "validation",
      "contributor.{name,email} are required"
    );
  }
  if (input.dco_text_version !== "1.1") {
    throw new PublishError(
      "validation",
      "dco_text_version must be '1.1'"
    );
  }
  // The build flow may zip from a temp path that lives outside the agntux
  // root, so we don't enforce a containment check between plugin_dir and
  // agntux_root — path traversal inside the manifest is caught by the
  // backend's per-file `..` validation. We do confirm plugin_dir exists.
  const resolvedDir = resolve(input.plugin_dir);
  try {
    const stat = statSync(resolvedDir);
    if (!stat.isDirectory()) {
      throw new PublishError(
        "validation",
        `plugin_dir is not a directory: ${resolvedDir}`
      );
    }
  } catch (err) {
    if (err instanceof PublishError) throw err;
    throw new PublishError("validation", `plugin_dir not found: ${resolvedDir}`);
  }
}

/** Pure handler — exported for unit tests. The MCP server's CallTool
 *  request handler wraps this and shapes the response into the MCP
 *  `content` envelope. */
export async function publishToTeam(
  input: PublishToTeamInput,
  opts: { fetchImpl?: typeof fetch; apiBase?: string } = {}
): Promise<PublishToTeamResult> {
  try {
    validateInput(input);
    const licenseJwt = await readLicenseJwt(input.agntux_root);

    // Client-side preflight (per P11 S7.3). Avoids a round-trip when the
    // cached JWT is plainly unusable; the backend re-runs every check
    // with full Ed25519 verification.
    const preflightErr = preflightLicenseJwt(licenseJwt, {
      org_slug: input.org_slug,
      team_slug: input.team_slug,
    });
    if (preflightErr) throw preflightErr;

    const files = buildManifest(input.plugin_dir);

    const apiBase =
      opts.apiBase ?? process.env.AGNTUX_API_URL ?? DEFAULT_API_BASE;
    const url = `${apiBase.replace(/\/+$/, "")}/api/teams/${encodeURIComponent(
      input.org_slug
    )}/marketplace/publish`;

    const fetchImpl = opts.fetchImpl ?? fetch;
    let res: Response;
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
    } catch (err) {
      return {
        ok: false,
        reason: "network",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        ok: false,
        reason: "network",
        error: `Backend returned non-JSON response (HTTP ${res.status})`,
      };
    }

    if (!res.ok) {
      const b = body as { reason?: PublishToTeamErr["reason"]; error?: string };
      return {
        ok: false,
        reason: b.reason ?? "network",
        error: b.error ?? `HTTP ${res.status}`,
      };
    }

    const b = body as { submitted_at?: string };
    return {
      ok: true,
      submitted_at: b.submitted_at ?? new Date().toISOString(),
      plugin_slug: input.plugin_slug,
      plugin_version: input.plugin_version,
      team_slug: input.team_slug,
    };
  } catch (err) {
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
  description:
    "Publish a built AgntUX plugin to a team's private marketplace. Reads the license JWT from teams.json, walks the plugin directory, and POSTs the manifest to the AgntUX backend. Returns a non-technical success record (no GitHub URL); on failure returns a structured reason the build skill can react to.",
  inputSchema: {
    type: "object" as const,
    properties: {
      team_slug: { type: "string" },
      org_slug: { type: "string" },
      plugin_slug: { type: "string" },
      plugin_version: { type: "string", description: "Semver string" },
      tarball_path: {
        type: "string",
        description:
          "Local path to the zipped plugin tree. Stored in the audit row; not opened by this tool.",
      },
      plugin_dir: {
        type: "string",
        description:
          "Local path to the unzipped plugin tree (the build_path). Walked to build the publish manifest.",
      },
      agntux_root: {
        type: "string",
        description:
          "Absolute path to the AgntUX project root (where .agntux/teams.json lives).",
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
  async handler(args: Record<string, unknown>) {
    const result = await publishToTeam(args as unknown as PublishToTeamInput);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result,
      isError: !result.ok,
    };
  },
};

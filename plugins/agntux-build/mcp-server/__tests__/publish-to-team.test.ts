import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildManifest,
  decodeLicenseClaims,
  preflightLicenseJwt,
  publishToTeam,
  readLicenseJwt,
  walkPluginDir,
} from "../src/tools/publish-to-team.js";

/** Build an unsigned JWT-shaped string with a claims payload. Signature is
 *  a placeholder — the client side never verifies it. */
function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "agntux-license-v1" }),
    "utf8"
  )
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const payload = Buffer.from(JSON.stringify(claims), "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${payload}.sig`;
}

const TOMORROW_S = Math.floor(Date.now() / 1000) + 86_400;
const YESTERDAY_S = Math.floor(Date.now() / 1000) - 86_400;

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://app.agntux.ai/api/license/v1",
    sub: "user-1",
    tier: "team",
    org_slug: "acme",
    subscription_status: "active",
    valid_for_team_slugs: ["platform"],
    iat: Math.floor(Date.now() / 1000),
    exp: TOMORROW_S,
    ...overrides,
  };
}

function makeAgntuxRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "agntux-build-test-"));
  mkdirSync(join(root, ".agntux"), { recursive: true });
  return root;
}

function seedTeamsJson(root: string, body: Record<string, unknown>): void {
  writeFileSync(
    join(root, ".agntux", "teams.json"),
    JSON.stringify(body),
    "utf8"
  );
}

function makePluginDir(root: string, slug: string): string {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify({ name: slug, version: "0.1.0" }),
    "utf8"
  );
  writeFileSync(
    join(dir, "CONTRIBUTING-SIGNATURE.md"),
    [
      "---",
      "contributor:",
      "  name: Jane Doe",
      "  email: jane@example.com",
      "dco:",
      '  version: "1.1"',
      "---",
      "Signed-off-by: Jane Doe <jane@example.com>",
    ].join("\n"),
    "utf8"
  );
  mkdirSync(join(dir, "skills", "foo"), { recursive: true });
  writeFileSync(join(dir, "skills", "foo", "SKILL.md"), "# Foo", "utf8");

  // Sneaky files that walkPluginDir should skip
  mkdirSync(join(dir, "node_modules", "junk"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules", "junk", "index.js"),
    "should be skipped",
    "utf8"
  );
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "out.js"), "compiled", "utf8");

  return dir;
}

const validInput = (root: string, dir: string) => ({
  team_slug: "platform",
  org_slug: "acme",
  plugin_slug: "agntux-foo",
  plugin_version: "0.1.0",
  tarball_path: "/Users/jane/Downloads/agntux-foo-v0.1.0.zip",
  contributor: { name: "Jane Doe", email: "jane@example.com" },
  dco_text_version: "1.1",
  agntux_root: root,
  plugin_dir: dir,
});

describe("walkPluginDir", () => {
  it("returns every file path sorted, skipping node_modules/dist", () => {
    const root = makeAgntuxRoot();
    const dir = makePluginDir(root, "agntux-foo");
    try {
      const paths = walkPluginDir(dir);
      expect(paths).toEqual([
        "CONTRIBUTING-SIGNATURE.md",
        "plugin.json",
        "skills/foo/SKILL.md",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("buildManifest", () => {
  it("base64-encodes each file under the plugin tree", () => {
    const root = makeAgntuxRoot();
    const dir = makePluginDir(root, "agntux-foo");
    try {
      const manifest = buildManifest(dir);
      expect(manifest.map((m) => m.path)).toEqual([
        "CONTRIBUTING-SIGNATURE.md",
        "plugin.json",
        "skills/foo/SKILL.md",
      ]);
      const plugin = manifest.find((m) => m.path === "plugin.json");
      expect(plugin).toBeDefined();
      const decoded = Buffer.from(plugin!.content_base64, "base64").toString(
        "utf8"
      );
      expect(JSON.parse(decoded).name).toBe("agntux-foo");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws on an empty plugin_dir", () => {
    const root = makeAgntuxRoot();
    const empty = join(root, "empty");
    mkdirSync(empty);
    try {
      expect(() => buildManifest(empty)).toThrow(/empty/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readLicenseJwt", () => {
  it("reads license_jwt out of teams.json", async () => {
    const root = makeAgntuxRoot();
    seedTeamsJson(root, { license_jwt: "abc.def.ghi", memberships: [] });
    try {
      expect(await readLicenseJwt(root)).toBe("abc.def.ghi");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when teams.json is missing", async () => {
    const root = makeAgntuxRoot();
    rmSync(join(root, ".agntux", "teams.json"), { force: true });
    try {
      await expect(readLicenseJwt(root)).rejects.toThrow(/teams\.json/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when license_jwt is absent", async () => {
    const root = makeAgntuxRoot();
    seedTeamsJson(root, { memberships: [] });
    try {
      await expect(readLicenseJwt(root)).rejects.toThrow(/license_jwt/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when teams.json is not valid JSON", async () => {
    const root = makeAgntuxRoot();
    writeFileSync(join(root, ".agntux", "teams.json"), "{not json", "utf8");
    try {
      await expect(readLicenseJwt(root)).rejects.toThrow(/valid JSON/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("decodeLicenseClaims", () => {
  it("decodes a well-formed JWT payload", () => {
    const jwt = makeJwt(validClaims());
    const claims = decodeLicenseClaims(jwt);
    expect(claims).not.toBeNull();
    expect(claims!.tier).toBe("team");
    expect(claims!.org_slug).toBe("acme");
  });

  it("returns null on a malformed JWT (wrong segment count)", () => {
    expect(decodeLicenseClaims("not.a.valid.jwt")).toBeNull();
    expect(decodeLicenseClaims("only-one-segment")).toBeNull();
  });

  it("returns null when the payload is not JSON", () => {
    const header = "abc";
    const bad = Buffer.from("not-json", "utf8")
      .toString("base64")
      .replace(/=+$/, "");
    expect(decodeLicenseClaims(`${header}.${bad}.sig`)).toBeNull();
  });
});

describe("preflightLicenseJwt", () => {
  const input = { org_slug: "acme", team_slug: "platform" };

  it("returns null for a valid trialing/active/lapse_grace JWT", () => {
    for (const status of ["trialing", "active", "lapse_grace"]) {
      const jwt = makeJwt(validClaims({ subscription_status: status }));
      expect(preflightLicenseJwt(jwt, input)).toBeNull();
    }
  });

  it("returns an auth error when the JWT is expired", () => {
    const jwt = makeJwt(validClaims({ exp: YESTERDAY_S }));
    const err = preflightLicenseJwt(jwt, input);
    expect(err).not.toBeNull();
    expect(err!.reason).toBe("auth");
    expect(err!.message).toMatch(/expired/);
  });

  it("returns an auth error when the JWT is malformed", () => {
    const err = preflightLicenseJwt("not.a.valid.jwt.string", input);
    expect(err).not.toBeNull();
    expect(err!.reason).toBe("auth");
  });

  it("rejects subscription_status that isn't trialing/active/lapse_grace", () => {
    for (const status of ["canceled_locked", "past_due", "canceled", "incomplete"]) {
      const jwt = makeJwt(validClaims({ subscription_status: status }));
      const err = preflightLicenseJwt(jwt, input);
      expect(err).not.toBeNull();
      expect(err!.reason).toBe("auth");
      expect(err!.message).toMatch(/subscription required/);
    }
  });

  it("rejects when org_slug doesn't match the requested org", () => {
    const jwt = makeJwt(validClaims({ org_slug: "other" }));
    const err = preflightLicenseJwt(jwt, input);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/authorizes org/);
  });

  it("rejects when team_slug isn't in valid_for_team_slugs", () => {
    const jwt = makeJwt(validClaims({ valid_for_team_slugs: ["other"] }));
    const err = preflightLicenseJwt(jwt, input);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/grant publish to team/);
  });

  it("rejects when tier isn't 'team'", () => {
    const jwt = makeJwt(validClaims({ tier: "pro" }));
    const err = preflightLicenseJwt(jwt, input);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/team-tier/);
  });

  it("uses the injected nowSeconds for expiry math (test determinism)", () => {
    const jwt = makeJwt(validClaims({ exp: 100 }));
    expect(preflightLicenseJwt(jwt, input, 50)).toBeNull();
    expect(preflightLicenseJwt(jwt, input, 200)).not.toBeNull();
  });
});

describe("publishToTeam", () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = makeAgntuxRoot();
    dir = makePluginDir(root, "agntux-foo");
    seedTeamsJson(root, {
      license_jwt: makeJwt(validClaims()),
      memberships: [{ team_slug: "platform", org_slug: "acme" }],
    });
  });

  function cleanup() {
    rmSync(root, { recursive: true, force: true });
  }

  it("POSTs to the publish endpoint with the license_jwt as Bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, submitted_at: "2026-05-12T00:00:00Z" }),
    });
    try {
      const result = await publishToTeam(validInput(root, dir), {
        fetchImpl: fetchMock as unknown as typeof fetch,
        apiBase: "https://app.example.test",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.submitted_at).toBe("2026-05-12T00:00:00Z");
      expect(result.team_slug).toBe("platform");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://app.example.test/api/teams/acme/marketplace/publish"
      );
      expect((init as RequestInit).method).toBe("POST");
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      const body = JSON.parse(
        (init as RequestInit).body as string
      ) as Record<string, unknown>;
      expect(body.team_slug).toBe("platform");
      expect(body.plugin_slug).toBe("agntux-foo");
      expect(body.plugin_version).toBe("0.1.0");
      expect(Array.isArray(body.files)).toBe(true);
      const files = body.files as Array<{ path: string }>;
      expect(files.map((f) => f.path).sort()).toEqual([
        "CONTRIBUTING-SIGNATURE.md",
        "plugin.json",
        "skills/foo/SKILL.md",
      ]);
    } finally {
      cleanup();
    }
  });

  it("returns reason='auth' WITHOUT a network call when license_jwt is expired", async () => {
    seedTeamsJson(root, {
      license_jwt: makeJwt(validClaims({ exp: YESTERDAY_S })),
      memberships: [{ team_slug: "platform", org_slug: "acme" }],
    });
    const fetchMock = vi.fn();
    try {
      const result = await publishToTeam(validInput(root, dir), {
        fetchImpl: fetchMock as unknown as typeof fetch,
        apiBase: "https://app.example.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("auth");
      expect(result.error).toMatch(/subscription required/);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("returns reason='auth' WITHOUT a network call when subscription_status is canceled_locked", async () => {
    seedTeamsJson(root, {
      license_jwt: makeJwt(
        validClaims({ subscription_status: "canceled_locked" })
      ),
      memberships: [{ team_slug: "platform", org_slug: "acme" }],
    });
    const fetchMock = vi.fn();
    try {
      const result = await publishToTeam(validInput(root, dir), {
        fetchImpl: fetchMock as unknown as typeof fetch,
        apiBase: "https://app.example.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("auth");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("returns reason='auth' when teams.json is missing", async () => {
    rmSync(join(root, ".agntux", "teams.json"), { force: true });
    try {
      const result = await publishToTeam(validInput(root, dir), {
        fetchImpl: vi.fn() as unknown as typeof fetch,
        apiBase: "https://app.example.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("auth");
    } finally {
      cleanup();
    }
  });

  it("returns reason='validation' on missing required input", async () => {
    const input = validInput(root, dir);
    (input as unknown as Record<string, unknown>).plugin_slug = "";
    try {
      const result = await publishToTeam(input, {
        fetchImpl: vi.fn() as unknown as typeof fetch,
        apiBase: "https://app.example.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("validation");
    } finally {
      cleanup();
    }
  });

  it("returns reason='validation' when plugin_dir is missing", async () => {
    const input = validInput(root, join(root, "missing"));
    try {
      const result = await publishToTeam(input, {
        fetchImpl: vi.fn() as unknown as typeof fetch,
        apiBase: "https://app.example.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("validation");
    } finally {
      cleanup();
    }
  });

  it("returns reason='network' on fetch throw", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    try {
      const result = await publishToTeam(validInput(root, dir), {
        fetchImpl: fetchMock as unknown as typeof fetch,
        apiBase: "https://app.example.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("network");
      expect(result.error).toMatch(/ECONNREFUSED/);
    } finally {
      cleanup();
    }
  });

  it("forwards a structured backend error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        ok: false,
        reason: "auth",
        error: "License JWT does not authorize this organization",
      }),
    });
    try {
      const result = await publishToTeam(validInput(root, dir), {
        fetchImpl: fetchMock as unknown as typeof fetch,
        apiBase: "https://app.example.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("auth");
      expect(result.error).toMatch(/does not authorize/);
    } finally {
      cleanup();
    }
  });

  it("falls back to reason='network' on a non-JSON backend response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("unexpected token");
      },
    });
    try {
      const result = await publishToTeam(validInput(root, dir), {
        fetchImpl: fetchMock as unknown as typeof fetch,
        apiBase: "https://app.example.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("network");
      expect(result.error).toMatch(/HTTP 502/);
    } finally {
      cleanup();
    }
  });
});

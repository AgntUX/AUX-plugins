import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _setCachePathsForTesting } from "../src/cache.js";
import { _setDevicePathForTesting } from "../src/device.js";
import { _resetKeyCacheForTesting } from "../src/jwt-verify.js";
import { _setKeysForTesting } from "../src/keys.js";
import {
  _setFetchForTesting as _setPairingFetch,
  _setPairingPathForTesting,
} from "../src/pairing.js";
import { _setFetchForTesting as _setRefreshFetch } from "../src/refresh.js";
import { _setSessionPathForTesting } from "../src/session.js";
import { existsSync, writeFileSync } from "node:fs";
import { createLicenseGate } from "../src/index.js";

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeJwt(args: {
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  kid: string;
  exp: number;
}): string {
  const header = b64url(
    JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: args.kid }),
  );
  const payload = b64url(
    JSON.stringify({
      iss: "https://app.agntux.ai",
      aud: "agntux-plugin",
      exp: args.exp,
    }),
  );
  const signingInput = Buffer.from(`${header}.${payload}`, "utf8");
  const signature = nodeSign(null, signingInput, args.privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

describe("createLicenseGate", () => {
  let tmp: string;
  let privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  const kid = "test-kid";

  function mockFetch(handlers: Record<string, (init: RequestInit) => unknown>) {
    return (async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (u.endsWith(pattern)) {
          const result = handler(init ?? {});
          if (result instanceof Response) return result;
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      throw new Error(`Unmocked fetch: ${u}`);
    }) as typeof fetch;
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mcp-license-gate-"));
    _setCachePathsForTesting(tmp, join(tmp, ".license"));
    _setSessionPathForTesting(join(tmp, ".session"));
    _setDevicePathForTesting(join(tmp, ".device"));
    _setPairingPathForTesting(join(tmp, ".pairing"));
    delete process.env.AGNTUX_DEV_MODE;
    const kp = generateKeyPairSync("ed25519");
    privateKey = kp.privateKey;
    const spki = kp.publicKey.export({ format: "pem", type: "spki" }).toString();
    _setKeysForTesting([{ kid, spki }]);
    _resetKeyCacheForTesting();
  });

  afterEach(() => {
    _setCachePathsForTesting(null, null);
    _setSessionPathForTesting(null);
    _setDevicePathForTesting(null);
    _setPairingPathForTesting(null);
    _setKeysForTesting(null);
    _setPairingFetch(null);
    _setRefreshFetch(null);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("is a no-op in dev mode", async () => {
    process.env.AGNTUX_DEV_MODE = "1";
    const gate = createLicenseGate({
      pluginName: "agntux-test",
      pluginVersion: "0.0.0",
    });
    const err = await gate.requireValidLicense({ reason: "tools/call" });
    expect(err).toBeUndefined();
    expect(gate.isDevMode()).toBe(true);
  });

  it("returns pairing_required when no session exists", async () => {
    _setPairingFetch(
      mockFetch({
        "/api/auth/magic-link/request": () => ({
          status: "registered",
          verification_url: "https://app.agntux.ai/connect/abc",
          expires_in: 900,
        }),
      }),
    );
    const gate = createLicenseGate({
      pluginName: "agntux-test",
      pluginVersion: "0.0.0",
    });
    const err = await gate.requireValidLicense({ reason: "tools/call" });
    expect(err).toBeDefined();
    expect(err?.isError).toBe(true);
    expect(err?.content[0].text).toContain("requires pairing");
    expect(err?.content[0].text).toContain("https://app.agntux.ai/connect/abc");
  });

  it("returns pairing_pending while the user has not approved", async () => {
    writeFileSync(
      join(tmp, ".pairing"),
      JSON.stringify({
        nonce: "n".repeat(32),
        verification_url: "https://app.agntux.ai/connect/n",
        expires_at: Math.floor(Date.now() / 1000) + 600,
      }),
      { mode: 0o600 },
    );
    _setPairingFetch(
      mockFetch({
        "/api/auth/magic-link/poll": () => ({ status: "pending" }),
      }),
    );
    const gate = createLicenseGate({
      pluginName: "agntux-test",
      pluginVersion: "0.0.0",
    });
    const err = await gate.requireValidLicense({ reason: "tools/call" });
    expect(err).toBeDefined();
    expect(err?.content[0].text).toContain("Pairing is in progress");
  });

  it("completes pairing when poll returns approved + then refresh succeeds", async () => {
    writeFileSync(
      join(tmp, ".pairing"),
      JSON.stringify({
        nonce: "n".repeat(32),
        verification_url: "https://app.agntux.ai/connect/n",
        expires_at: Math.floor(Date.now() / 1000) + 600,
      }),
      { mode: 0o600 },
    );
    _setPairingFetch(
      mockFetch({
        "/api/auth/magic-link/poll": () => ({
          status: "approved",
          session_token: "session-abc",
          user_id: "user-1",
        }),
      }),
    );
    const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
    const jwt = makeJwt({ privateKey, kid, exp });
    _setRefreshFetch(
      mockFetch({
        "/api/license/refresh": () => ({
          token: jwt,
          expires_at: exp,
        }),
      }),
    );
    const gate = createLicenseGate({
      pluginName: "agntux-test",
      pluginVersion: "0.0.0",
    });
    const err = await gate.requireValidLicense({ reason: "tools/call" });
    expect(err).toBeUndefined();
  });

  it("returns trial_expired when refresh returns 402 trial_expired", async () => {
    writeFileSync(join(tmp, ".session"), "session-abc", { mode: 0o600 });
    _setRefreshFetch(
      mockFetch({
        "/api/license/refresh": () =>
          new Response(
            JSON.stringify({
              error: "trial_expired",
              upgrade_url: "https://app.agntux.ai/billing",
            }),
            { status: 402, headers: { "Content-Type": "application/json" } },
          ),
      }),
    );
    const gate = createLicenseGate({
      pluginName: "agntux-test",
      pluginVersion: "0.0.0",
    });
    const err = await gate.requireValidLicense({ reason: "tools/call" });
    expect(err).toBeDefined();
    expect(err?.content[0].text).toContain("trial has ended");
  });

  it("is a no-op when a valid cached license is present", async () => {
    const exp = Math.floor(Date.now() / 1000) + 23 * 3600;
    const jwt = makeJwt({ privateKey, kid, exp });
    writeFileSync(
      join(tmp, ".license"),
      JSON.stringify({ token: jwt, expires_at: exp }),
      { mode: 0o600 },
    );
    const gate = createLicenseGate({
      pluginName: "agntux-test",
      pluginVersion: "0.0.0",
    });
    const err = await gate.requireValidLicense({ reason: "tools/call" });
    expect(err).toBeUndefined();
  });

  it("clears the session file when refresh reports invalid_session", async () => {
    writeFileSync(join(tmp, ".session"), "session-stale", { mode: 0o600 });
    _setRefreshFetch(
      mockFetch({
        "/api/license/refresh": () =>
          new Response(JSON.stringify({ error: "invalid_session" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    );
    const gate = createLicenseGate({
      pluginName: "agntux-test",
      pluginVersion: "0.0.0",
    });
    const err = await gate.requireValidLicense({ reason: "tools/call" });
    expect(err).toBeDefined();
    expect(err?.content[0].text).toContain("session is no longer valid");
    expect(existsSync(join(tmp, ".session"))).toBe(false);
  });

  it("re-pairs when the local pairing record has expired", async () => {
    writeFileSync(
      join(tmp, ".pairing"),
      JSON.stringify({
        nonce: "n".repeat(32),
        verification_url: "https://app.agntux.ai/connect/n",
        expires_at: Math.floor(Date.now() / 1000) - 60,
      }),
      { mode: 0o600 },
    );
    _setPairingFetch(
      mockFetch({
        "/api/auth/magic-link/request": () => ({
          status: "registered",
          verification_url: "https://app.agntux.ai/connect/fresh",
          expires_in: 900,
        }),
      }),
    );
    const gate = createLicenseGate({
      pluginName: "agntux-test",
      pluginVersion: "0.0.0",
    });
    const err = await gate.requireValidLicense({ reason: "tools/call" });
    expect(err).toBeDefined();
    expect(err?.content[0].text).toContain("https://app.agntux.ai/connect/fresh");
  });

  it("returns network_unavailable when refresh fails on the network", async () => {
    writeFileSync(join(tmp, ".session"), "session-abc", { mode: 0o600 });
    _setRefreshFetch((async () => {
      throw new Error("EAI_AGAIN");
    }) as typeof fetch);
    const gate = createLicenseGate({
      pluginName: "agntux-test",
      pluginVersion: "0.0.0",
    });
    const err = await gate.requireValidLicense({ reason: "tools/call" });
    expect(err).toBeDefined();
    expect(err?.content[0].text).toContain("Cannot reach AgntUX");
  });

  it("respects AGNTUX_API_BASE override in error envelope URLs", async () => {
    process.env.AGNTUX_API_BASE = "http://localhost:3001";
    _setPairingFetch(
      mockFetch({
        "/api/auth/magic-link/request": () => ({
          status: "registered",
          verification_url: "http://localhost:3001/connect/abc",
          expires_in: 900,
        }),
      }),
    );
    const gate = createLicenseGate({
      pluginName: "agntux-test",
      pluginVersion: "0.0.0",
    });
    const err = await gate.requireValidLicense({ reason: "tools/call" });
    delete process.env.AGNTUX_API_BASE;
    expect(err?.content[0].text).toContain("http://localhost:3001/connect/abc");
  });
});

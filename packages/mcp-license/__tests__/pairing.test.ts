import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _setFetchForTesting,
  _setPairingPathForTesting,
  clearPairing,
  generateNonce,
  pollPairing,
  readPairing,
  requestPairing,
  writePairing,
} from "../src/pairing.js";

describe("pairing state", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mcp-license-pairing-"));
    _setPairingPathForTesting(join(tmp, "sub", ".pairing"));
  });

  afterEach(() => {
    _setPairingPathForTesting(null);
    _setFetchForTesting(null);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when no pairing exists", () => {
    expect(readPairing()).toBeNull();
  });

  it("round-trips a pairing record", () => {
    const state = {
      nonce: "n".repeat(32),
      verification_url: "https://app.agntux.ai/connect/n",
      expires_at: 1234567890,
    };
    writePairing(state);
    expect(readPairing()).toEqual(state);
  });

  it("clearPairing removes the file and is idempotent", () => {
    writePairing({
      nonce: "n".repeat(32),
      verification_url: "https://app.agntux.ai/connect/n",
      expires_at: 1234567890,
    });
    clearPairing();
    expect(readPairing()).toBeNull();
    expect(() => clearPairing()).not.toThrow();
  });

  it("generateNonce returns a sufficiently long base64url string", () => {
    const n = generateNonce();
    expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes encoded as base64url ≈ 43 chars
    expect(n.length).toBeGreaterThanOrEqual(32);
  });
});

describe("pairing API helpers", () => {
  beforeEach(() => {
    _setFetchForTesting(null);
  });

  afterEach(() => {
    _setFetchForTesting(null);
  });

  it("requestPairing returns ok with verification_url on 200", async () => {
    _setFetchForTesting((async () =>
      new Response(
        JSON.stringify({
          status: "registered",
          verification_url: "https://app.agntux.ai/connect/abc",
          expires_in: 900,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch);
    const result = await requestPairing({
      apiBase: "https://app.agntux.ai",
      deviceId: "dev_abc",
      deviceName: "test",
      nonce: "n".repeat(32),
    });
    expect(result.ok).toBe(true);
    expect(result.verification_url).toBe("https://app.agntux.ai/connect/abc");
  });

  it("requestPairing surfaces error on non-200", async () => {
    _setFetchForTesting((async () =>
      new Response(JSON.stringify({ error: "invalid_nonce" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch);
    const result = await requestPairing({
      apiBase: "https://app.agntux.ai",
      deviceId: "dev_abc",
      deviceName: "test",
      nonce: "n".repeat(32),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_nonce");
  });

  it("pollPairing returns the state field", async () => {
    _setFetchForTesting((async () =>
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch);
    const result = await pollPairing({
      apiBase: "https://app.agntux.ai",
      nonce: "n".repeat(32),
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("pending");
  });

  it("pollPairing flags 410 expired", async () => {
    _setFetchForTesting((async () =>
      new Response(JSON.stringify({ error: "expired" }), {
        status: 410,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch);
    const result = await pollPairing({
      apiBase: "https://app.agntux.ai",
      nonce: "n".repeat(32),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
  });

  it("pollPairing handles network errors", async () => {
    _setFetchForTesting((async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch);
    const result = await pollPairing({
      apiBase: "https://app.agntux.ai",
      nonce: "n".repeat(32),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });
});

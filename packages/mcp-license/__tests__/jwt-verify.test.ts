import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetKeyCacheForTesting,
  verifyLicense,
} from "../src/jwt-verify.js";
import { _setKeysForTesting } from "../src/keys.js";

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
  payload: Record<string, unknown>;
  alg?: string;
}): string {
  const header = b64url(
    JSON.stringify({ alg: args.alg ?? "EdDSA", typ: "JWT", kid: args.kid }),
  );
  const payload = b64url(JSON.stringify(args.payload));
  const signingInput = Buffer.from(`${header}.${payload}`, "utf8");
  const signature = nodeSign(null, signingInput, args.privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

describe("verifyLicense", () => {
  afterEach(() => {
    _setKeysForTesting(null);
    _resetKeyCacheForTesting();
  });

  function setupTestKey(kid = "test-kid-1") {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "pem", type: "spki" }).toString();
    _setKeysForTesting([{ kid, spki }]);
    _resetKeyCacheForTesting();
    return { privateKey, kid };
  }

  it("accepts a valid token", () => {
    const { privateKey, kid } = setupTestKey();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = makeJwt({
      privateKey,
      kid,
      payload: { iss: "https://app.agntux.ai", aud: "agntux-plugin", exp },
    });
    const result = verifyLicense(jwt);
    expect(result.ok).toBe(true);
  });

  it("rejects past-exp tokens", () => {
    const { privateKey, kid } = setupTestKey();
    const exp = Math.floor(Date.now() / 1000) - 1;
    const jwt = makeJwt({
      privateKey,
      kid,
      payload: { iss: "https://app.agntux.ai", aud: "agntux-plugin", exp },
    });
    const result = verifyLicense(jwt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("rejects unknown kid", () => {
    const { privateKey } = setupTestKey("known-kid");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = makeJwt({
      privateKey,
      kid: "different-kid",
      payload: { iss: "https://app.agntux.ai", aud: "agntux-plugin", exp },
    });
    const result = verifyLicense(jwt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_kid");
  });

  it("rejects wrong issuer", () => {
    const { privateKey, kid } = setupTestKey();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = makeJwt({
      privateKey,
      kid,
      payload: { iss: "https://evil.example", aud: "agntux-plugin", exp },
    });
    const result = verifyLicense(jwt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_iss");
  });

  it("rejects malformed jwt", () => {
    const result = verifyLicense("not-a-jwt");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });
});

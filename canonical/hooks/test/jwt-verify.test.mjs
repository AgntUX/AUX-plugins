import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import {
  verifyLicense,
  _setPublicKeyForTesting,
} from "../lib/jwt-verify.mjs";
import {
  getTestKeys,
  mintJwt,
  defaultClaims,
} from "./fixtures/test-key.mjs";

// Install the synthetic public key for the whole suite. Synthetic kid
// matches the default in mintJwt ("agntux-license-v1").
_setPublicKeyForTesting(getTestKeys().publicKeyPem, "agntux-license-v1");

test("verifyLicense: rejects non-string input", () => {
  assert.equal(verifyLicense(null).ok, false);
  assert.equal(verifyLicense(null).reason, "malformed");
  assert.equal(verifyLicense(undefined).reason, "malformed");
  assert.equal(verifyLicense(42).reason, "malformed");
});

test("verifyLicense: rejects malformed JWT (wrong part count)", () => {
  assert.equal(verifyLicense("not.a.jwt.really").reason, "malformed");
  assert.equal(verifyLicense("two.parts").reason, "malformed");
  assert.equal(verifyLicense("").reason, "malformed");
});

test("verifyLicense: rejects malformed base64 / JSON", () => {
  // valid 3-part split but not base64-decodable JSON
  const bad = "!!!.@@@.###";
  const r = verifyLicense(bad);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "malformed");
});

test("verifyLicense: accepts a valid token", () => {
  const claims = defaultClaims();
  const jwt = mintJwt(claims);
  const r = verifyLicense(jwt, { now: claims.iat + 10 });
  assert.equal(r.ok, true);
  assert.equal(r.payload.iss, "https://app.agntux.ai");
});

test("verifyLicense: rejects wrong alg in header", () => {
  const jwt = mintJwt(defaultClaims(), { alg: "HS256" });
  const r = verifyLicense(jwt);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "wrong_alg");
});

test("verifyLicense: rejects unknown kid", () => {
  const jwt = mintJwt(defaultClaims(), { kid: "agntux-license-v999" });
  const r = verifyLicense(jwt, { expectedKid: "agntux-license-v1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown_kid");
});

test("verifyLicense: rejects bad signature (tampered byte)", () => {
  const jwt = mintJwt(defaultClaims());
  // flip a byte in the signature segment (last segment)
  const parts = jwt.split(".");
  const sigBuf = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - parts[2].length % 4) % 4), "base64");
  sigBuf[0] ^= 0xff;
  const tamperedSig = sigBuf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const tampered = `${parts[0]}.${parts[1]}.${tamperedSig}`;
  const r = verifyLicense(tampered);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad_signature");
});

test("verifyLicense: rejects wrong issuer", () => {
  const jwt = mintJwt(defaultClaims({ iss: "https://evil.example.com" }));
  const r = verifyLicense(jwt);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "wrong_iss");
});

test("verifyLicense: rejects wrong audience", () => {
  const jwt = mintJwt(defaultClaims({ aud: "web-app" }));
  const r = verifyLicense(jwt);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "wrong_aud");
});

test("verifyLicense: rejects nbf in future (with skew)", () => {
  const claims = defaultClaims({ nbf: Math.floor(Date.now() / 1000) + 10000 });
  const jwt = mintJwt(claims);
  const r = verifyLicense(jwt, { now: Math.floor(Date.now() / 1000) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_yet_valid");
});

test("verifyLicense: zero-grace expired (P2.AMEND.3)", () => {
  // Past `exp` — must be flat rejected. No mode:'grace' return path.
  const now = Math.floor(Date.now() / 1000);
  const claims = defaultClaims({
    iat: now - 7200,
    nbf: now - 7200,
    exp: now - 3600,
  });
  const jwt = mintJwt(claims);
  const r = verifyLicense(jwt, { now });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
  // CRITICAL: no `mode: "grace"` ever exists.
  assert.notEqual(r.mode, "grace");
});

test("verifyLicense: ignores grace_until claim entirely (P2.AMEND.3)", () => {
  // Even with a far-future grace_until, expired tokens are dead.
  const now = Math.floor(Date.now() / 1000);
  const claims = defaultClaims({
    iat: now - 7200,
    nbf: now - 7200,
    exp: now - 3600,
    grace_until: now + 86400 * 365, // a year in the future — ignored
  });
  const jwt = mintJwt(claims);
  const r = verifyLicense(jwt, { now });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
});

test("verifyLicense: missing exp is malformed", () => {
  const claims = defaultClaims();
  delete claims.exp;
  const jwt = mintJwt(claims);
  const r = verifyLicense(jwt);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "malformed");
});

test("verifyLicense: token signed by wrong key (different keypair) -> bad_signature", () => {
  // Mint with a different private key than the verifier expects.
  const other = generateKeyPairSync("ed25519");
  const jwt = mintJwt(defaultClaims(), { privateKey: other.privateKey });
  const r = verifyLicense(jwt);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad_signature");
});

test("verifyLicense: kind=developer-sandbox is verified identically", () => {
  const claims = defaultClaims({ kind: "developer-sandbox" });
  const jwt = mintJwt(claims);
  const r = verifyLicense(jwt, { now: claims.iat + 10 });
  assert.equal(r.ok, true);
  assert.equal(r.payload.kind, "developer-sandbox");
});

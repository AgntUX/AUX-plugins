// Synthetic Ed25519 keypair + JWT-mint helpers for tests. Generated lazily
// once per process; the public key is fed into `verifyLicense` via the
// `_setPublicKeyForTesting` hook so tests don't depend on the
// T13-placeholder shipped in `lib/public-key.mjs`.

import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

let CACHED = null;

export function getTestKeys() {
  if (CACHED) return CACHED;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  CACHED = {
    publicKey,
    privateKey,
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }),
  };
  return CACHED;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function mintJwt(payload, opts) {
  const o = opts || {};
  const keys = getTestKeys();
  const privateKey = o.privateKey || keys.privateKey;
  const header = {
    alg: o.alg || "EdDSA",
    typ: "JWT",
    kid: o.kid || "agntux-license-v1",
  };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  let signature;
  if (o.signatureBytes) {
    // explicit override (tests want a tampered/invalid signature)
    signature = o.signatureBytes;
  } else {
    signature = cryptoSign(null, signingInput, privateKey);
  }
  return `${headerB64}.${payloadB64}.${b64url(signature)}`;
}

export function defaultClaims(overrides) {
  const now = Math.floor(Date.now() / 1000);
  return Object.assign({
    iss: "https://app.agntux.ai",
    sub: "usr_test",
    aud: "agntux-plugin",
    iat: now,
    exp: now + 3600,
    nbf: now,
    jti: "lic_test",
    kind: "production",
    plan: "trial",
    allowed_plugins: ["*"],
    max_devices: 3,
    device_id: "dev_test",
  }, overrides || {});
}

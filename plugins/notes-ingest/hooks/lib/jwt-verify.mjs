// Local-only JWT verifier for the AgntUX licence token.
// Pure ESM, zero deps, Node >= 20 built-ins only.
//
// Per P2.AMEND.3 (zero-grace): `grace_until` is NOT honoured. Past `exp` we
// return { ok: false, reason: "expired" } unconditionally. There is no
// `mode: "grace"` return path. Cached `grace_until` fields from older
// versions are ignored.

import { createPublicKey, verify } from "node:crypto";
import { PUBLIC_KEY_SPKI_PEM, PUBLIC_KEY_KID } from "./public-key.mjs";

const EXPECTED_ISS = "https://app.agntux.ai";
const EXPECTED_AUD = "agntux-plugin";

// Lazy-init the parsed public key. Module-level cache so the cost of
// `createPublicKey` is paid once per process, not per validate call.
// Critical for the PreToolUse p99 < 5ms target.
let CACHED_KEY = null;
let EXPECTED_KID_OVERRIDE = null;

function getKey() {
  if (CACHED_KEY === null) {
    CACHED_KEY = createPublicKey(PUBLIC_KEY_SPKI_PEM);
  }
  return CACHED_KEY;
}

function expectedKid() {
  return EXPECTED_KID_OVERRIDE !== null ? EXPECTED_KID_OVERRIDE : PUBLIC_KEY_KID;
}

// Test-only hook: lets the unit-test harness substitute a synthetic public
// key without rewriting `lib/public-key.mjs` (which ships as a placeholder).
// Also overrides the expected kid (the placeholder shipped value is
// "{{PUBLIC_KEY_KID}}" which would never match a synthetic test JWT).
export function _setPublicKeyForTesting(pem, kid) {
  if (pem === null) {
    CACHED_KEY = null;
    EXPECTED_KID_OVERRIDE = null;
    return;
  }
  CACHED_KEY = createPublicKey(pem);
  EXPECTED_KID_OVERRIDE = typeof kid === "string" ? kid : "agntux-license-v1";
}

function b64urlDecode(s) {
  if (typeof s !== "string") return Buffer.alloc(0);
  // Convert base64url to base64 and pad.
  let normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  if (pad === 2) normalized += "==";
  else if (pad === 3) normalized += "=";
  else if (pad === 1) return Buffer.alloc(0); // invalid
  return Buffer.from(normalized, "base64");
}

export function verifyLicense(jwt, opts) {
  const now = (opts && typeof opts.now === "number")
    ? opts.now
    : Math.floor(Date.now() / 1000);
  const wantKid = (opts && typeof opts.expectedKid === "string")
    ? opts.expectedKid
    : expectedKid();

  if (typeof jwt !== "string" || jwt.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const parts = jwt.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  let header, payload;
  try {
    const headerBuf = b64urlDecode(parts[0]);
    const payloadBuf = b64urlDecode(parts[1]);
    if (headerBuf.length === 0 || payloadBuf.length === 0) {
      return { ok: false, reason: "malformed" };
    }
    header = JSON.parse(headerBuf.toString("utf8"));
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (header.alg !== "EdDSA") return { ok: false, reason: "wrong_alg" };
  if (header.kid !== wantKid) return { ok: false, reason: "unknown_kid" };

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  const signature = b64urlDecode(parts[2]);
  if (signature.length !== 64) {
    return { ok: false, reason: "malformed" };
  }

  let signatureValid = false;
  try {
    signatureValid = verify(null, signingInput, getKey(), signature);
  } catch {
    return { ok: false, reason: "verify_error" };
  }
  if (!signatureValid) return { ok: false, reason: "bad_signature" };

  if (payload.iss !== EXPECTED_ISS) return { ok: false, reason: "wrong_iss" };
  if (payload.aud !== EXPECTED_AUD) return { ok: false, reason: "wrong_aud" };
  if (typeof payload.nbf === "number" && now + 30 < payload.nbf) {
    return { ok: false, reason: "not_yet_valid" };
  }

  // Zero-grace expiry per P2.AMEND.3. Cached `grace_until` is ignored.
  if (typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (now >= payload.exp) {
    return { ok: false, reason: "expired", payload };
  }

  return { ok: true, payload };
}

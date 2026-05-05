// Local-only Ed25519 JWT verifier for the AgntUX license token.
// Pure ESM, zero deps, Node >=20 built-ins only.
//
// Multiple active kids supported via keys.ts ACTIVE_KEYS. Past `exp` returns
// `{ ok: false, reason: "expired", payload }` unconditionally — there is no
// grace branch.
import { createPublicKey, verify } from "node:crypto";
import { activeKeys } from "./keys.js";
const EXPECTED_ISS = "https://app.agntux.ai";
const EXPECTED_AUD = "agntux-plugin";
const KEY_CACHE = new Map();
function getKey(kid) {
    const cached = KEY_CACHE.get(kid);
    if (cached)
        return cached;
    const match = activeKeys().find((k) => k.kid === kid);
    if (!match)
        return null;
    const obj = createPublicKey(match.spki);
    KEY_CACHE.set(kid, obj);
    return obj;
}
export function _resetKeyCacheForTesting() {
    KEY_CACHE.clear();
}
function b64urlDecode(s) {
    if (typeof s !== "string")
        return Buffer.alloc(0);
    let normalized = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4;
    if (pad === 2)
        normalized += "==";
    else if (pad === 3)
        normalized += "=";
    else if (pad === 1)
        return Buffer.alloc(0);
    return Buffer.from(normalized, "base64");
}
export function verifyLicense(jwt, opts) {
    const now = opts && typeof opts.now === "number"
        ? opts.now
        : Math.floor(Date.now() / 1000);
    if (typeof jwt !== "string" || jwt.length === 0) {
        return { ok: false, reason: "malformed" };
    }
    const parts = jwt.split(".");
    if (parts.length !== 3)
        return { ok: false, reason: "malformed" };
    let header;
    let payload;
    try {
        const headerBuf = b64urlDecode(parts[0]);
        const payloadBuf = b64urlDecode(parts[1]);
        if (headerBuf.length === 0 || payloadBuf.length === 0) {
            return { ok: false, reason: "malformed" };
        }
        header = JSON.parse(headerBuf.toString("utf8"));
        payload = JSON.parse(payloadBuf.toString("utf8"));
    }
    catch {
        return { ok: false, reason: "malformed" };
    }
    if (header.alg !== "EdDSA")
        return { ok: false, reason: "wrong_alg" };
    if (typeof header.kid !== "string")
        return { ok: false, reason: "unknown_kid" };
    const key = getKey(header.kid);
    if (!key)
        return { ok: false, reason: "unknown_kid" };
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
    const signature = b64urlDecode(parts[2]);
    if (signature.length !== 64) {
        return { ok: false, reason: "malformed" };
    }
    let signatureValid = false;
    try {
        signatureValid = verify(null, signingInput, key, signature);
    }
    catch {
        return { ok: false, reason: "verify_error" };
    }
    if (!signatureValid)
        return { ok: false, reason: "bad_signature" };
    if (payload.iss !== EXPECTED_ISS)
        return { ok: false, reason: "wrong_iss" };
    if (payload.aud !== EXPECTED_AUD)
        return { ok: false, reason: "wrong_aud" };
    if (typeof payload.nbf === "number" && now + 30 < payload.nbf) {
        return { ok: false, reason: "not_yet_valid" };
    }
    if (typeof payload.exp !== "number") {
        return { ok: false, reason: "malformed" };
    }
    if (now >= payload.exp) {
        return { ok: false, reason: "expired", payload };
    }
    return { ok: true, payload };
}

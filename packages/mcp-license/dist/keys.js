// Active Ed25519 public keys for AgntUX license JWT verification.
//
// Rotation procedure: add the new {kid, spki} pair to ACTIVE_KEYS, bump this
// package's version, ship a release. Old kids stay listed for one transition
// window so already-issued JWTs keep verifying, then are removed in the next
// release.
export const ACTIVE_KEYS = [
    {
        kid: "agntux-license-v1",
        spki: "-----BEGIN PUBLIC KEY-----\n" +
            "MCowBQYDK2VwAyEA8WVzf12gfIrg5TT9DxnTFU/mO/7UKEQMTAc2JX+AUO4=\n" +
            "-----END PUBLIC KEY-----\n",
    },
];
let TEST_OVERRIDE = null;
export function _setKeysForTesting(keys) {
    TEST_OVERRIDE = keys;
}
export function activeKeys() {
    return TEST_OVERRIDE ?? ACTIVE_KEYS;
}

// Active Ed25519 public keys for AgntUX license JWT verification.
//
// Rotation procedure: add the new {kid, spki} pair to ACTIVE_KEYS, bump this
// package's version, ship a release. Old kids stay listed for one transition
// window so already-issued JWTs keep verifying, then are removed in the next
// release.

export interface ActiveKey {
  kid: string;
  spki: string;
}

export const ACTIVE_KEYS: ActiveKey[] = [
  {
    kid: "agntux-license-v1",
    spki:
      "-----BEGIN PUBLIC KEY-----\n" +
      "MCowBQYDK2VwAyEA8WVzf12gfIrg5TT9DxnTFU/mO/7UKEQMTAc2JX+AUO4=\n" +
      "-----END PUBLIC KEY-----\n",
  },
];

let TEST_OVERRIDE: ActiveKey[] | null = null;

export function _setKeysForTesting(keys: ActiveKey[] | null): void {
  TEST_OVERRIDE = keys;
}

export function activeKeys(): ActiveKey[] {
  return TEST_OVERRIDE ?? ACTIVE_KEYS;
}

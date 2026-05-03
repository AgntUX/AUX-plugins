// Embedded Ed25519 public key for AgntUX licence signing key.
//
// The two `export const` lines below carry the active license-key values
// from `canonical/kms-public-keys.json` (agntux-license-v1, substituted at
// plugin-build time per T13). Rotation = ship a new plugin version with
// these constants updated. There is NO runtime fetch of public keys.
// See `~/.claude/plans/p2-keys.md` §7.

export const PUBLIC_KEY_KID = "agntux-license-v1";

export const PUBLIC_KEY_SPKI_PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA8WVzf12gfIrg5TT9DxnTFU/mO/7UKEQMTAc2JX+AUO4=\n-----END PUBLIC KEY-----\n";

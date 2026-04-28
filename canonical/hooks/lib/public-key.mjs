// Embedded Ed25519 public key for AgntUX licence signing key.
//
// The two `export const` lines below carry placeholder string values. T13's
// plugin-update machinery substitutes them at copy-time by string-replacing
// the placeholder tokens with the active license-key entry from
// `~/.claude/plans/p2-fixtures/kms-public-keys.json`. Pattern:
//   "{{PUBLIC_KEY_KID}}"      -> "agntux-license-v1"
//   "{{PUBLIC_KEY_SPKI_PEM}}" -> "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
//
// Rotation = ship a new plugin version with these constants updated. There
// is NO runtime fetch of public keys. See `~/.claude/plans/p2-keys.md` §7.

export const PUBLIC_KEY_KID = "{{PUBLIC_KEY_KID}}";

export const PUBLIC_KEY_SPKI_PEM = "{{PUBLIC_KEY_SPKI_PEM}}";

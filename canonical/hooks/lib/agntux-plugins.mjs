// AgntUX plugin slug list. Used by `lib/scope.mjs` to decide whether a given
// `mcp__{slug}__{tool}` call is in-scope for license enforcement.
//
// The `export const` line below carries a placeholder array. T13 substitutes
// at copy-time by replacing the literal token below with a JSON array
// generated from the canonical marketplace.json. Pattern:
//   ["{{AGNTUX_PLUGIN_SLUGS}}"] -> ["agntux-core", "slack-ingest", ...]
//
// CI gates the substitution: every plugin's `hooks/` bundle must carry the
// same slug list (P2 §8 byte-frozen invariants).

export const AGNTUX_PLUGIN_SLUGS = ["{{AGNTUX_PLUGIN_SLUGS}}"];

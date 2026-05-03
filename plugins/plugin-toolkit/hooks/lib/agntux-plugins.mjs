// AgntUX plugin slug list. Used by `lib/scope.mjs` to decide whether a given
// `mcp__{slug}__{tool}` call is in-scope for license enforcement.
//
// Substituted at plugin-build time by T13 with the canonical marketplace slug
// list. Grows as new AgntUX plugins ship.

export const AGNTUX_PLUGIN_SLUGS = ["agntux-core", "plugin-toolkit"];

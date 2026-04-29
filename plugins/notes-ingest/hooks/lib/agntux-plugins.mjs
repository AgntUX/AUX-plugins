// AgntUX plugin slug list. Used by `lib/scope.mjs` to decide whether a given
// `mcp__{slug}__{tool}` call is in-scope for license enforcement.
//
// Substituted at plugin-build time by T13 with the canonical marketplace slug
// list. This file carries the current known slugs for the initial release.

export const AGNTUX_PLUGIN_SLUGS = ["agntux-core", "notes-ingest"];

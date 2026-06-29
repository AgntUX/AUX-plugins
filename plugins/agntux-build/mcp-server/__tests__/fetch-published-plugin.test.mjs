// Unit tests for the pure member-selection logic of agntux_fetch_published_plugin.
// The network download + `tar` extraction are exercised live by the verification
// steps in the plan (real GitHub fetch of a published plugin), not mocked here —
// same split as marketplace-lookup.test.mjs. Importing ../src/index.js is
// side-effect-free (the server starts only when run as the main module).
//
// Lives under __tests__/ NOT src/, because build.js copies every src/*.js
// verbatim into the shipped dist/ — a test under src/ would ship.

import { describe, it, expect } from "vitest";
import { selectPluginTarballMembers, canonicalPluginSlug } from "../src/index.js";

// A representative `tar -tzf` listing for a GitHub repo tarball: every member is
// under a single `{owner}-{repo}-{sha}/` top dir. Two plugins, one of which has a
// confusable longer name (agntux-linear vs agntux-linear-board).
const PREFIX = "AgntUX-AUX-plugins-abc1234";
const LISTING = [
  `${PREFIX}/`,
  `${PREFIX}/README.md`,
  `${PREFIX}/plugins/`,
  `${PREFIX}/plugins/agntux-linear/`,
  `${PREFIX}/plugins/agntux-linear/.claude-plugin/`,
  `${PREFIX}/plugins/agntux-linear/.claude-plugin/plugin.json`,
  `${PREFIX}/plugins/agntux-linear/README.md`,
  `${PREFIX}/plugins/agntux-linear/skills/build/references/revise.md`,
  `${PREFIX}/plugins/agntux-linear-board/`,
  `${PREFIX}/plugins/agntux-linear-board/README.md`,
  `${PREFIX}/plugins/agntux-other/`,
  `${PREFIX}/plugins/agntux-other/README.md`,
].join("\n");

describe("selectPluginTarballMembers", () => {
  it("derives the top-level prefix from the first listing line", () => {
    const { prefix } = selectPluginTarballMembers(LISTING.split("\n"), "agntux-linear");
    expect(prefix).toBe(PREFIX);
  });

  it("returns exactly the members under plugins/{canonical}/", () => {
    const { members } = selectPluginTarballMembers(LISTING.split("\n"), "agntux-linear");
    expect(members).toContain(`${PREFIX}/plugins/agntux-linear/`);
    expect(members).toContain(`${PREFIX}/plugins/agntux-linear/.claude-plugin/plugin.json`);
    expect(members).toContain(`${PREFIX}/plugins/agntux-linear/skills/build/references/revise.md`);
  });

  it("does not pick up a confusable sibling (agntux-linear ⊄ agntux-linear-board)", () => {
    const { members } = selectPluginTarballMembers(LISTING.split("\n"), "agntux-linear");
    expect(members.some((m) => m.includes("agntux-linear-board"))).toBe(false);
    expect(members.some((m) => m.includes("agntux-other"))).toBe(false);
  });

  it("does not pick up the shorter sibling in reverse (agntux-linear-board ⊄ agntux-linear)", () => {
    const { members } = selectPluginTarballMembers(LISTING.split("\n"), "agntux-linear-board");
    expect(members).toContain(`${PREFIX}/plugins/agntux-linear-board/`);
    expect(members).toContain(`${PREFIX}/plugins/agntux-linear-board/README.md`);
    // every member must be under the board dir, never a bare agntux-linear path
    expect(members.every((m) => m.startsWith(`${PREFIX}/plugins/agntux-linear-board`))).toBe(true);
  });

  it("ignores a leading pax_global_header pseudo-entry (GNU tar lists it; BSD omits it)", () => {
    // git-archive tarballs (what GitHub serves) carry a `pax_global_header` with
    // the commit sha; GNU tar (Linux) lists it FIRST. The prefix must still be
    // derived from the real top dir, not that headerless line — else every Linux
    // fetch would derive prefix="pax_global_header" and return a false not_found.
    const withHeader = ["pax_global_header", ...LISTING.split("\n")];
    const { prefix, members } = selectPluginTarballMembers(withHeader, "agntux-linear");
    expect(prefix).toBe(PREFIX);
    expect(members).toContain(`${PREFIX}/plugins/agntux-linear/.claude-plugin/plugin.json`);
  });
});

describe("canonicalPluginSlug does NOT sanitize traversal — the handler's SAFE_SLUG_RE guard is load-bearing", () => {
  // Documents WHY handleFetchPublishedPlugin must validate the canonical slug
  // before using it in path.join + rmSync: canonicalPluginSlug only lowercases
  // and prefixes, so a traversal sequence survives it and would otherwise reach
  // a destructive rmSync(buildPath). The live driver asserts the guard rejects it.
  it("leaves `/` and `..` intact (proves a downstream allow-list is required)", () => {
    expect(canonicalPluginSlug("../../../../tmp/x")).toBe("agntux-../../../../tmp/x");
    expect(canonicalPluginSlug("a/b")).toBe("agntux-a/b");
  });

  it("accepts a raw string listing as well as an array of lines", () => {
    const fromString = selectPluginTarballMembers(LISTING, "agntux-linear");
    const fromArray = selectPluginTarballMembers(LISTING.split("\n"), "agntux-linear");
    expect(fromString.members).toEqual(fromArray.members);
    expect(fromString.prefix).toBe(fromArray.prefix);
  });

  it("returns no members when the plugin dir is absent (not published → not_found)", () => {
    const { prefix, members } = selectPluginTarballMembers(LISTING.split("\n"), "agntux-notreal");
    expect(prefix).toBe(PREFIX);
    expect(members).toHaveLength(0);
  });

  it("tolerates empty / garbage input", () => {
    expect(selectPluginTarballMembers([], "agntux-linear")).toEqual({ prefix: "", members: [] });
    expect(selectPluginTarballMembers("", "agntux-linear")).toEqual({ prefix: "", members: [] });
    expect(selectPluginTarballMembers(LISTING.split("\n"), "")).toEqual({ prefix: "", members: [] });
    expect(selectPluginTarballMembers(null, "agntux-linear")).toEqual({ prefix: "", members: [] });
  });

  it("trims whitespace and ignores blank lines", () => {
    const padded = `  ${PREFIX}/  \n\n   ${PREFIX}/plugins/agntux-linear/README.md  \n`;
    const { prefix, members } = selectPluginTarballMembers(padded, "agntux-linear");
    expect(prefix).toBe(PREFIX);
    expect(members).toContain(`${PREFIX}/plugins/agntux-linear/README.md`);
  });
});

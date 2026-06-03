// Unit tests for the stage-1 anti-duplicate gate's pure matcher. These cover the
// matching logic only — the network fetch (Contents API → cache-busted raw →
// local → cache) is exercised live by the verification steps in the plan, not
// mocked here. Importing ../src/index.js is side-effect-free (the server starts
// only when run as the main module).
//
// This file lives under __tests__/ NOT src/, because build.js copies every
// src/*.js verbatim into the shipped dist/ — a test under src/ would ship.

import { describe, it, expect } from "vitest";
import { matchMarketplace, canonicalPluginSlug } from "../src/index.js";

// A representative slice of the aggregate index shape ({ plugins: { slug: {…} } }).
const INDEX = {
  generated_at: "2026-06-02T00:00:00.000Z",
  plugins: {
    "agntux-build": {
      tagline: "Build a new AgntUX plugin.",
      keywords: ["plugin", "build", "contribute"],
    },
    "agntux-gmail": {
      tagline: "Triage your Gmail inbox inside AgntUX.",
      description: "Pulls Gmail threads into the knowledge store.",
      keywords: ["mail", "email", "inbox"],
    },
    "agntux-github": {
      tagline: "Pull GitHub issues and PRs into AgntUX.",
      keywords: ["git", "issues", "pull-requests"],
    },
    "agntux-google-calendar": {
      tagline: "Sync Google Calendar events.",
      keywords: ["calendar", "events", "scheduling"],
    },
  },
};

describe("canonicalPluginSlug", () => {
  it("prefixes a bare slug", () => {
    expect(canonicalPluginSlug("linear")).toBe("agntux-linear");
  });
  it("leaves an already-prefixed slug intact", () => {
    expect(canonicalPluginSlug("agntux-linear")).toBe("agntux-linear");
  });
  it("lowercases and trims", () => {
    expect(canonicalPluginSlug("  Linear ")).toBe("agntux-linear");
  });
  it("returns empty for empty/garbage input", () => {
    expect(canonicalPluginSlug("")).toBe("");
    expect(canonicalPluginSlug(null)).toBe("");
    expect(canonicalPluginSlug(undefined)).toBe("");
  });
});

describe("matchMarketplace — exact hit (the anti-duplicate signal)", () => {
  it("matches a bare slug", () => {
    const r = matchMarketplace(INDEX, { slug: "gmail" });
    expect(r.exact_match?.slug).toBe("agntux-gmail");
    expect(r.exact_match?.tagline).toContain("Gmail");
    expect(r.exact_match?.description).toContain("knowledge store");
    expect(r.total_plugins).toBe(4);
  });
  it("matches an already-prefixed slug", () => {
    const r = matchMarketplace(INDEX, { slug: "agntux-build" });
    expect(r.exact_match?.slug).toBe("agntux-build");
  });
  it("excludes the exact hit from keyword_matches (reported once)", () => {
    const r = matchMarketplace(INDEX, { slug: "gmail", query: "mail" });
    expect(r.exact_match?.slug).toBe("agntux-gmail");
    expect(r.keyword_matches.find((m) => m.slug === "agntux-gmail")).toBeUndefined();
  });
});

describe("matchMarketplace — soft keyword/tagline hit", () => {
  it("finds a related plugin via a tagline/keyword token when no exact hit", () => {
    const r = matchMarketplace(INDEX, { slug: "calendar-thing", query: "calendar scheduling" });
    expect(r.exact_match).toBeNull();
    expect(r.keyword_matches.map((m) => m.slug)).toContain("agntux-google-calendar");
    const hit = r.keyword_matches.find((m) => m.slug === "agntux-google-calendar");
    expect(hit?.tagline).toBe("Sync Google Calendar events.");
    // slug is checked before keyword/tagline — lock that precedence.
    expect(hit?.matched_on).toBe("slug:calendar");
  });
  it("matches an alias word carried in the query (mail → gmail)", () => {
    const r = matchMarketplace(INDEX, { slug: "newmailthing", query: "mail email" });
    expect(r.exact_match).toBeNull();
    expect(r.keyword_matches.map((m) => m.slug)).toContain("agntux-gmail");
  });
  it("matches on word boundaries, not raw substrings (box ⊄ inbox, go ⊄ google)", () => {
    // "box" must NOT soft-match agntux-gmail via the keyword "inbox", and "go"
    // must NOT soft-match agntux-google-calendar via the slug "google-calendar".
    const box = matchMarketplace(INDEX, { slug: "box", query: "box" });
    expect(box.keyword_matches.map((m) => m.slug)).not.toContain("agntux-gmail");
    const go = matchMarketplace(INDEX, { slug: "go-thing", query: "go" });
    expect(go.keyword_matches.map((m) => m.slug)).not.toContain("agntux-google-calendar");
  });
});

describe("matchMarketplace — genuine miss (safe to build new)", () => {
  it("returns no exact and no soft match for an unrelated system", () => {
    const r = matchMarketplace(INDEX, { slug: "linear", query: "linear project tracker" });
    expect(r.exact_match).toBeNull();
    expect(r.keyword_matches).toHaveLength(0);
  });
});

describe("matchMarketplace — defensive", () => {
  it("tolerates a null index", () => {
    expect(matchMarketplace(null, { slug: "x" })).toEqual({
      total_plugins: 0,
      exact_match: null,
      keyword_matches: [],
    });
  });
  it("tolerates an index with no plugins object", () => {
    expect(matchMarketplace({}, { slug: "x" }).total_plugins).toBe(0);
    expect(matchMarketplace({ plugins: [] }, { slug: "x" }).total_plugins).toBe(0);
  });
  it("does not throw on entries missing keywords/tagline", () => {
    const sparse = { plugins: { "agntux-bare": {} } };
    const r = matchMarketplace(sparse, { slug: "bare" });
    expect(r.exact_match?.slug).toBe("agntux-bare");
    expect(r.exact_match?.tagline).toBe("");
  });
});

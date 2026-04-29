// Tests for the in-memory LRU cache layer in s3-fetch.ts.
// Strategy: import lruGet/lruSet/memCache directly (exported for testing) rather
// than wiring through fetchUIBundle with a mocked https.request, because the
// LRU logic is self-contained and this avoids coupling the test to I/O mocking.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { lruGet, lruSet, memCache, CACHE_TTL_MS, CACHE_MAX } from "../src/s3-fetch.js";

beforeEach(() => {
  memCache.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  memCache.clear();
});

describe("LRU eviction", () => {
  it("101st insert evicts the LRU (oldest) entry when at capacity", () => {
    // Fill cache to CACHE_MAX.
    for (let i = 0; i < CACHE_MAX; i++) {
      lruSet(`key-${i}`, `html-${i}`);
    }
    expect(memCache.size).toBe(CACHE_MAX);

    // The first key inserted is the LRU entry.
    const evictedKey = "key-0";
    expect(lruGet(evictedKey)).toBe(`html-0`); // still present before 101st insert

    // Re-clear and re-fill without accessing key-0, so it stays LRU.
    memCache.clear();
    for (let i = 0; i < CACHE_MAX; i++) {
      lruSet(`key-${i}`, `html-${i}`);
    }

    // 101st insert should evict key-0.
    lruSet("key-100", "html-100");
    expect(memCache.size).toBe(CACHE_MAX);
    expect(lruGet(evictedKey)).toBeUndefined(); // evicted
    expect(lruGet("key-100")).toBe("html-100"); // new entry present
  });

  it("get on a recently-accessed entry rescues it from eviction", () => {
    // Fill cache to capacity, access key-0 to make it MRU.
    for (let i = 0; i < CACHE_MAX; i++) {
      lruSet(`key-${i}`, `html-${i}`);
    }
    // Access key-0 — moves it to end (MRU).
    lruGet("key-0");

    // 101st insert should evict key-1 (now the LRU), not key-0.
    lruSet("key-100", "html-100");
    expect(lruGet("key-0")).toBe("html-0"); // rescued by access
    expect(lruGet("key-1")).toBeUndefined(); // evicted
  });
});

describe("TTL expiry", () => {
  it("entry past CACHE_TTL_MS returns undefined and is removed from the map", () => {
    vi.useFakeTimers();
    lruSet("stale-key", "<html>stale</html>");
    expect(lruGet("stale-key")).toBe("<html>stale</html>");

    // Advance time past TTL.
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);

    expect(lruGet("stale-key")).toBeUndefined();
    expect(memCache.has("stale-key")).toBe(false); // self-deleted
  });

  it("entry within TTL is still returned", () => {
    vi.useFakeTimers();
    lruSet("fresh-key", "<html>fresh</html>");

    vi.advanceTimersByTime(CACHE_TTL_MS - 1000);

    expect(lruGet("fresh-key")).toBe("<html>fresh</html>");
  });
});

describe("recency on get", () => {
  it("lruGet moves the entry to most-recently-used position", () => {
    lruSet("a", "html-a");
    lruSet("b", "html-b");
    lruSet("c", "html-c");

    // Access "a" — it should move to end.
    lruGet("a");

    // The Map iteration order reflects insertion (with move-to-end).
    const keys = [...memCache.keys()];
    expect(keys[keys.length - 1]).toBe("a");
  });
});

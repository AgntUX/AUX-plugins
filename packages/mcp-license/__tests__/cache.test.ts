import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _setCachePathsForTesting,
  readLicenseCache,
  writeLicenseCache,
} from "../src/cache.js";

describe("license cache", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mcp-license-cache-"));
    _setCachePathsForTesting(tmp, join(tmp, ".license"));
  });

  afterEach(() => {
    _setCachePathsForTesting(null, null);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when no cache exists", () => {
    expect(readLicenseCache()).toBeNull();
  });

  it("round-trips a record", () => {
    writeLicenseCache({ token: "abc", expires_at: 1234567890 });
    const got = readLicenseCache();
    expect(got).not.toBeNull();
    if (got && !("_corrupt" in got)) {
      expect(got.token).toBe("abc");
      expect(got.expires_at).toBe(1234567890);
    }
  });

  it("flags corrupt JSON", () => {
    writeLicenseCache({ token: "ok" });
    writeFileSync(join(tmp, ".license"), "{ not json", { mode: 0o600 });
    const got = readLicenseCache();
    expect(got && "_corrupt" in got).toBe(true);
  });

  it("writes mode 0600", () => {
    writeLicenseCache({ token: "abc" });
    const st = statSync(join(tmp, ".license"));
    expect(st.mode & 0o777).toBe(0o600);
  });
});

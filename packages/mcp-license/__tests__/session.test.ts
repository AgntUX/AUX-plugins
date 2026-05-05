import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _setSessionPathForTesting,
  clearSession,
  readSession,
  writeSession,
} from "../src/session.js";

describe("session I/O", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mcp-license-session-"));
    _setSessionPathForTesting(join(tmp, "sub", ".session"));
  });

  afterEach(() => {
    _setSessionPathForTesting(null);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when no session exists", () => {
    expect(readSession()).toBeNull();
  });

  it("round-trips a token and writes mode 0600", () => {
    writeSession("session-abc-123");
    expect(readSession()).toBe("session-abc-123");
    const st = statSync(join(tmp, "sub", ".session"));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("clearSession is idempotent and removes the file", () => {
    writeSession("token");
    expect(readSession()).toBe("token");
    clearSession();
    expect(readSession()).toBeNull();
    // Calling clearSession again on missing file should not throw.
    expect(() => clearSession()).not.toThrow();
  });

  it("rejects empty / non-string token", () => {
    expect(() => writeSession("")).toThrow();
    // @ts-expect-error — runtime guard for a non-string input.
    expect(() => writeSession(null)).toThrow();
  });
});

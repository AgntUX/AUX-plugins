import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _setDevicePathForTesting,
  _setHostnameForTesting,
  getOrCreateDeviceId,
} from "../src/device.js";

describe("device id", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mcp-license-device-"));
    _setDevicePathForTesting(join(tmp, "sub", ".device"));
    _setHostnameForTesting("test-host");
  });

  afterEach(() => {
    _setDevicePathForTesting(null);
    _setHostnameForTesting(null);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("mints a `dev_<hex>` id on first call", () => {
    const id = getOrCreateDeviceId();
    expect(id).toMatch(/^dev_[a-f0-9]{16,}$/);
  });

  it("is stable across calls", () => {
    const a = getOrCreateDeviceId();
    const b = getOrCreateDeviceId();
    expect(a).toBe(b);
  });

  it("re-mints when the on-disk value is corrupt", () => {
    mkdirSync(join(tmp, "sub"), { recursive: true, mode: 0o700 });
    writeFileSync(join(tmp, "sub", ".device"), "garbage", { mode: 0o600 });
    const id = getOrCreateDeviceId();
    expect(id).toMatch(/^dev_[a-f0-9]{16,}$/);
    expect(id).not.toBe("garbage");
  });

  it("writes the file mode 0600", () => {
    getOrCreateDeviceId();
    const st = statSync(join(tmp, "sub", ".device"));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("persists the same id across processes (simulated by re-read)", () => {
    const a = getOrCreateDeviceId();
    const onDisk = readFileSync(join(tmp, "sub", ".device"), "utf8").trim();
    expect(onDisk).toBe(a);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _setFetchForTesting, refreshLicense } from "../src/refresh.js";

describe("refreshLicense", () => {
  beforeEach(() => {
    _setFetchForTesting(null);
  });

  afterEach(() => {
    _setFetchForTesting(null);
  });

  it("returns ok with body on 200", async () => {
    _setFetchForTesting((async () =>
      new Response(JSON.stringify({ token: "jwt", expires_at: 999 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch);
    const result = await refreshLicense({
      apiBase: "https://app.agntux.ai",
      sessionToken: "session",
      deviceId: "dev_abc",
      pluginVersions: { "agntux-test": "0.0.0" },
    });
    expect(result.ok).toBe(true);
    expect(result.body?.token).toBe("jwt");
  });

  it("surfaces structured error on 402 trial_expired", async () => {
    _setFetchForTesting((async () =>
      new Response(
        JSON.stringify({
          error: "trial_expired",
          upgrade_url: "https://app.agntux.ai/billing",
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch);
    const result = await refreshLicense({
      apiBase: "https://app.agntux.ai",
      sessionToken: "session",
      deviceId: "dev_abc",
      pluginVersions: {},
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("trial_expired");
    expect(result.upgrade_url).toBe("https://app.agntux.ai/billing");
  });

  it("falls back to http_<status> when error field is absent", async () => {
    _setFetchForTesting((async () =>
      new Response(JSON.stringify({}), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch);
    const result = await refreshLicense({
      apiBase: "https://app.agntux.ai",
      sessionToken: "session",
      deviceId: "dev_abc",
      pluginVersions: {},
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("http_503");
  });

  it("flags network failures with reason: 'network'", async () => {
    _setFetchForTesting((async () => {
      throw new Error("EAI_AGAIN");
    }) as typeof fetch);
    const result = await refreshLicense({
      apiBase: "https://app.agntux.ai",
      sessionToken: "session",
      deviceId: "dev_abc",
      pluginVersions: {},
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("network");
  });
});

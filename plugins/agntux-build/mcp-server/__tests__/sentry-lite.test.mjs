import { describe, it, expect, afterEach } from "vitest";
import { scrub, scrubString, createSentry } from "../src/sentry-lite.js";

// Every denylist term, including normalized variants (mixed case, punctuation
// that isSensitiveKey strips before the substring check).
const SENSITIVE_KEYS = [
  "authorization",
  "Cookie",
  "access_token",
  "client_secret",
  "password",
  "passwd",
  "jwt",
  "API_KEY",
  "private_key",
  "refresh_token",
  "id_token",
  "session_id",
  "aws_credential",
  "Bearer",
  "signing_key",
];

describe("scrub — object key denylist", () => {
  it("redacts every sensitive key, including nested", () => {
    const input = {
      status: "ok",
      plugin: "agntux-build",
      nested: { tool: "agntux_validate" },
    };
    for (const k of SENSITIVE_KEYS) input[k] = "super-secret-value";
    input.nested.authorization = "another-secret";

    const out = scrub(input);

    for (const k of SENSITIVE_KEYS) {
      expect(out[k]).toBe("[redacted]");
    }
    expect(out.nested.authorization).toBe("[redacted]");
  });

  it("leaves ordinary keys untouched", () => {
    const out = scrub({
      status: "failed",
      plugin: "agntux-build",
      nested: { tool: "agntux_report_defect", count: 3 },
    });
    expect(out.status).toBe("failed");
    expect(out.plugin).toBe("agntux-build");
    expect(out.nested.tool).toBe("agntux_report_defect");
    expect(out.nested.count).toBe(3);
  });

  it("handles circular references without throwing", () => {
    const a = { plugin: "agntux-build" };
    a.self = a;
    expect(() => scrub(a)).not.toThrow();
    const out = scrub(a);
    expect(out.plugin).toBe("agntux-build");
    expect(out.self).toBeUndefined();
  });

  it("recurses through arrays", () => {
    const out = scrub({ items: [{ token: "x" }, { status: "live" }] });
    expect(out.items[0].token).toBe("[redacted]");
    expect(out.items[1].status).toBe("live");
  });
});

describe("scrubString — value patterns", () => {
  it("redacts a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = scrubString(`token=${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("[redacted-jwt]");
  });

  it("redacts a Bearer credential", () => {
    const out = scrubString("Authorization: Bearer abc123DEF.ghi-456");
    expect(out).not.toContain("abc123DEF.ghi-456");
    expect(out).toContain("[redacted]");
  });

  it("redacts URL userinfo", () => {
    const out = scrubString("connecting to https://user:hunter2@example.com/x");
    expect(out).not.toContain("user:hunter2");
    expect(out).toContain("https://[redacted]@example.com/x");
  });

  it("redacts a Sentry auth token", () => {
    const out = scrubString("dsn key sntrys_abcdEFGH12345678 used");
    expect(out).not.toContain("sntrys_abcdEFGH12345678");
    expect(out).toContain("[redacted-token]");
  });
});

describe("createSentry — disabled via kill switch", () => {
  const prev = process.env.AGNTUX_DISABLE_TELEMETRY;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGNTUX_DISABLE_TELEMETRY;
    else process.env.AGNTUX_DISABLE_TELEMETRY = prev;
  });

  it("returns enabled:false and resolves null without network", async () => {
    process.env.AGNTUX_DISABLE_TELEMETRY = "1";
    const s = createSentry({ tags: { plugin: "agntux-build" } });
    expect(s.enabled).toBe(false);
    await expect(s.captureException(new Error("boom"))).resolves.toBeNull();
    await expect(s.captureMessage("hi", { token: "x" }, "error")).resolves.toBeNull();
  });
});

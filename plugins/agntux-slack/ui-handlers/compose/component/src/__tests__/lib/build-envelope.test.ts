/**
 * build-envelope.test.ts
 *
 * Tests for the committed host_prompt envelope builder.
 */

import { describe, it, expect } from "vitest";
import { buildEnvelope } from "../../lib/build-envelope.js";

describe("buildEnvelope", () => {
  it("produces a send envelope with the correct shape", () => {
    const result = buildEnvelope("my-action", "send", "Hello world");
    expect(result).toBe(
      "ux: Use the agntux-slack plugin to commit the drafted reply for action my-action with body «Hello world» (mode: send).",
    );
  });

  it("produces a schedule envelope with send_at", () => {
    const result = buildEnvelope(
      "my-action",
      "schedule",
      "See you tomorrow",
      "2026-05-05T09:00:00.000Z",
    );
    expect(result).toContain("mode: schedule, send_at: 2026-05-05T09:00:00.000Z");
    expect(result).toContain("«See you tomorrow»");
  });

  it("omits send_at for schedule mode when send_at is absent", () => {
    const result = buildEnvelope("my-action", "schedule", "body");
    expect(result).toContain("mode: schedule");
    expect(result).not.toContain("send_at");
  });

  it("produces a save_draft envelope", () => {
    const result = buildEnvelope("my-action", "save_draft", "draft body");
    expect(result).toContain("mode: save_draft");
    expect(result).toContain("«draft body»");
  });

  it("escapes literal « in the body by doubling", () => {
    const result = buildEnvelope("my-action", "send", "Hello «world»");
    expect(result).toContain("«Hello ««world»»»");
  });

  it("escapes multiple guillemets", () => {
    const result = buildEnvelope("my-action", "send", "«a» and «b»");
    // Both « and » should be doubled
    expect(result).toContain("««a»»");
    expect(result).toContain("««b»»");
  });

  it("ignores send_at for non-schedule mode even when provided", () => {
    const result = buildEnvelope("my-action", "send", "body", "2026-05-05T09:00:00Z");
    expect(result).not.toContain("send_at");
    expect(result).toContain("mode: send");
  });

  it("handles empty body without crashing", () => {
    const result = buildEnvelope("my-action", "send", "");
    expect(result).toContain("«»");
    expect(result).toContain("mode: send");
  });
});

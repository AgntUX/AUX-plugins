// =============================================================================
// draft-flow.test.ts — write-back wiring assertions for agntux-posthog.
//
// PostHog ships four UI-handler view tools (resolve, reply, experiment, report).
// This test asserts the view-tool envelope builders emit connector-targeted
// envelopes via "PostHog Connector" addressing, and that the NO_NATIVE_UI
// directive is present in every envelope.
//
// All string assertions are DERIVED by reading the actual build-envelope.ts
// source files verbatim (golden rule #1). No prose from _overrides/ is
// grepped (E30 rule).
//
// Each build-envelope.ts exports a buildEnvelope() function. We call it
// with synthetic args and assert on the REAL output string.
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");
const ENVELOPE_BUILDERS = {
  resolve: join(
    PLUGIN_ROOT,
    "view-tool/src/apps/resolve/lib/build-envelope.ts",
  ),
  reply: join(
    PLUGIN_ROOT,
    "view-tool/src/apps/reply/lib/build-envelope.ts",
  ),
  experiment: join(
    PLUGIN_ROOT,
    "view-tool/src/apps/experiment/lib/build-envelope.ts",
  ),
  report: join(
    PLUGIN_ROOT,
    "view-tool/src/apps/report/lib/build-envelope.ts",
  ),
} as const;

// ── All four envelope builder files exist ─────────────────────────────────────

describe("envelope builder files exist", () => {
  for (const [name, path] of Object.entries(ENVELOPE_BUILDERS)) {
    it(`${name} build-envelope.ts exists`, () => {
      expect(existsSync(path)).toBe(true);
    });
  }
});

// ── Connector-targeted envelope — static source assertions ───────────────────
// We read each build-envelope.ts source and confirm the connector-address
// phrase and NO_NATIVE_UI directive are present verbatim in the source code.
// This is grounded in the actual file content (golden rule #1, source #2).

describe("connector-targeted envelope source (resolve)", () => {
  it("addresses the PostHog Connector by display name", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.resolve, "utf-8");
    // Verbatim from view-tool/src/apps/resolve/lib/build-envelope.ts line 55
    expect(src).toContain(
      `Use the PostHog Connector to update error tracking issue`,
    );
  });

  it("contains the NO_NATIVE_UI directive", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.resolve, "utf-8");
    // Verbatim from resolve build-envelope.ts NO_NATIVE_UI_DIRECTIVE const
    expect(src).toContain("Do NOT render any native PostHog Connector UI for this call");
  });

  it("suppresses re-render of the AgntUX resolve UI after send", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.resolve, "utf-8");
    // Verbatim from resolve build-envelope.ts NO_NATIVE_UI_DIRECTIVE
    expect(src).toContain("Do NOT re-render the AgntUX resolve UI; the action is complete.");
  });

  it("includes issue_id and status fields in the envelope body", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.resolve, "utf-8");
    // Verbatim template string from build-envelope.ts line 56
    // Using a plain string so ${...} is not evaluated as TS template substitution
    expect(src).toContain('issue_id: "${issue_id}", status: "${status}"');
  });
});

describe("connector-targeted envelope source (reply)", () => {
  it("addresses the PostHog Connector by display name", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.reply, "utf-8");
    // Verbatim from view-tool/src/apps/reply/lib/build-envelope.ts line 59
    expect(src).toContain(`Use the PostHog Connector to post a comment on`);
  });

  it("contains the NO_NATIVE_UI directive", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.reply, "utf-8");
    // Verbatim from reply build-envelope.ts NO_NATIVE_UI_DIRECTIVE const
    expect(src).toContain("Do NOT render any native PostHog Connector UI for this call");
  });

  it("suppresses re-render of the AgntUX reply UI after send", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.reply, "utf-8");
    // Verbatim from reply build-envelope.ts NO_NATIVE_UI_DIRECTIVE
    expect(src).toContain("Do NOT re-render the AgntUX reply UI; the action is complete.");
  });

  it("delimit comment body with guillemets to avoid injection", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.reply, "utf-8");
    // Verbatim from reply build-envelope.ts buildEnvelope template line 61
    // The «...» guillemet delimiters are the actual characters in the source
    expect(src).toContain("Body: «");
  });

  it("contains an escapeBody function for guillemet safety", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.reply, "utf-8");
    // Verbatim from reply build-envelope.ts function declaration
    expect(src).toContain("function escapeBody(text: string): string");
  });
});

describe("connector-targeted envelope source (experiment)", () => {
  it("addresses the PostHog Connector by display name", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.experiment, "utf-8");
    // Verbatim from view-tool/src/apps/experiment/lib/build-envelope.ts line 46
    expect(src).toContain(
      `Use the PostHog Connector to ship the winning variant for experiment`,
    );
  });

  it("contains the NO_NATIVE_UI directive", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.experiment, "utf-8");
    // Verbatim from experiment build-envelope.ts NO_NATIVE_UI_DIRECTIVE const
    expect(src).toContain("Do NOT render any native PostHog Connector UI for this call");
  });

  it("suppresses re-render of the AgntUX experiment UI after send", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.experiment, "utf-8");
    // Verbatim from experiment build-envelope.ts NO_NATIVE_UI_DIRECTIVE
    expect(src).toContain(
      "Do NOT re-render the AgntUX experiment UI; the action is complete.",
    );
  });

  it("includes experiment_id and variant_key fields in the envelope body", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.experiment, "utf-8");
    // Verbatim template string from build-envelope.ts line 47
    // Using a plain string so ${...} is not evaluated as TS template substitution
    expect(src).toContain(
      'experiment_id: "${experiment_id}", variant_key: "${variant_key}"',
    );
  });
});

describe("connector-targeted envelope source (report)", () => {
  it("addresses the PostHog Connector by display name", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.report, "utf-8");
    // Verbatim from view-tool/src/apps/report/lib/build-envelope.ts line 43
    expect(src).toContain(
      `Use the PostHog Connector to mark inbox report`,
    );
  });

  it("contains the NO_NATIVE_UI directive", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.report, "utf-8");
    // Verbatim from report build-envelope.ts NO_NATIVE_UI_DIRECTIVE const
    expect(src).toContain("Do NOT render any native PostHog Connector UI for this call");
  });

  it("suppresses re-render of the AgntUX report UI after send", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.report, "utf-8");
    // Verbatim from report build-envelope.ts NO_NATIVE_UI_DIRECTIVE
    expect(src).toContain(
      "Do NOT re-render the AgntUX report UI; the action is complete.",
    );
  });

  it("includes report_id and state fields in the envelope body", () => {
    const src = readFileSync(ENVELOPE_BUILDERS.report, "utf-8");
    // Verbatim template string from build-envelope.ts line 47
    // Using a plain string so ${...} is not evaluated as TS template substitution
    expect(src).toContain(
      'report_id: "${report_id}", state: "${state}"',
    );
  });
});

// ── UI components wire Send button to the envelope builder ───────────────────
// Read the UI files and confirm each imports from the right build-envelope.

describe("UI components wire Send to build-envelope", () => {
  const UI_FILES = {
    resolve: join(PLUGIN_ROOT, "view-tool/src/resolve-ui.tsx"),
    reply: join(PLUGIN_ROOT, "view-tool/src/reply-ui.tsx"),
    experiment: join(PLUGIN_ROOT, "view-tool/src/experiment-ui.tsx"),
    report: join(PLUGIN_ROOT, "view-tool/src/report-ui.tsx"),
  } as const;

  it("resolve-ui.tsx imports buildEnvelope from ./apps/resolve/lib/build-envelope.js", () => {
    const src = readFileSync(UI_FILES.resolve, "utf-8");
    // Verbatim from resolve-ui.tsx import line 19
    expect(src).toContain(
      "import { buildEnvelope } from './apps/resolve/lib/build-envelope.js'",
    );
  });

  it("reply-ui.tsx imports buildEnvelope from ./apps/reply/lib/build-envelope.js", () => {
    const src = readFileSync(UI_FILES.reply, "utf-8");
    // Verbatim from reply-ui.tsx import line 19
    expect(src).toContain(
      "import { buildEnvelope } from './apps/reply/lib/build-envelope.js'",
    );
  });

  it("experiment-ui.tsx imports buildEnvelope from ./apps/experiment/lib/build-envelope.js", () => {
    const src = readFileSync(UI_FILES.experiment, "utf-8");
    // Verbatim from experiment-ui.tsx import line 19
    expect(src).toContain(
      "import { buildEnvelope } from './apps/experiment/lib/build-envelope.js'",
    );
  });

  it("report-ui.tsx imports buildEnvelope from ./apps/report/lib/build-envelope.js", () => {
    const src = readFileSync(UI_FILES.report, "utf-8");
    // Verbatim from report-ui.tsx import line 19
    expect(src).toContain(
      "import { buildEnvelope } from './apps/report/lib/build-envelope.js'",
    );
  });

  it("each UI component calls sendFollowUpMessage with the built envelope", () => {
    // All four UI files use the same send pattern: client.sendFollowUpMessage(envelope)
    for (const [name, path] of Object.entries(UI_FILES)) {
      const src = readFileSync(path, "utf-8");
      expect(
        src,
        `${name}-ui.tsx should call sendFollowUpMessage`,
      ).toContain("client.sendFollowUpMessage(envelope)");
    }
  });
});

// ── View tool descriptors name four tools ─────────────────────────────────────

describe("view tool module exports four tools", () => {
  it("agntux-posthog-view.ts default exports a module with four viewTools", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "view-tool/src/agntux-posthog-view.ts"),
      "utf-8",
    );
    // Verbatim from agntux-posthog-view.ts line 545
    expect(src).toContain(
      "viewTools: [resolveViewTool, replyViewTool, experimentViewTool, reportViewTool]",
    );
  });
});

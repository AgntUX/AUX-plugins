// cold-start: confirms the plugin's structural shape so a fresh user
// loading agntux-build at install time gets a valid plugin tree.
//
// Static-grep only — no LLM, no spawn. Mirrors the cold-start tests
// other AUX-plugins ship.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");

describe("agntux-build cold start", () => {
  it("ships the required marketplace files", () => {
    for (const f of [
      ".claude-plugin/plugin.json",
      "LICENSE",
      "NOTICE",
      "README.md",
      "CHANGELOG.md",
      "marketplace/listing.yaml",
      "marketplace/icon.png",
    ]) {
      expect(existsSync(join(PLUGIN_ROOT, f)), `missing ${f}`).toBe(true);
    }
  });

  it("ships at least one screenshot", () => {
    const dir = join(PLUGIN_ROOT, "marketplace", "screenshots");
    expect(existsSync(dir)).toBe(true);
  });

  it("plugin.json declares the right shape", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"),
      "utf-8",
    );
    const m = JSON.parse(raw);
    expect(m.name).toBe("agntux-build");
    expect(m.license).toBe("Apache-2.0");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof m.description).toBe("string");
    expect(m.description.length).toBeGreaterThan(20);
  });

  it("listing.yaml carries supported_prompts pointing at /agntux-build:build", () => {
    const raw = readFileSync(
      join(PLUGIN_ROOT, "marketplace", "listing.yaml"),
      "utf-8",
    );
    const parsed = yaml.load(raw) as {
      supported_prompts?: { prompt: string }[];
    };
    expect(parsed.supported_prompts).toBeDefined();
    const prompts = (parsed.supported_prompts ?? []).map((p) => p.prompt);
    expect(prompts).toContain("/agntux-build:build");
  });

  it("ships the orchestrator skill at skills/build/SKILL.md", () => {
    const skillPath = join(PLUGIN_ROOT, "skills", "build", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    const body = readFileSync(skillPath, "utf-8");
    // disable-model-invocation must be set so the skill doesn't auto-trigger.
    expect(body).toMatch(/disable-model-invocation:\s*true/);
    // The voice rules must be inline, not pushed to a reference.
    expect(body).toMatch(/voice/i);
    // Slash command surface is `/agntux-build:build`.
    expect(body).toMatch(/\/agntux-build:build/);
  });

  it("ships all reference files", () => {
    const refs = [
      "00-identity-and-dco.md",
      "01-search-marketplace.md",
      "02-install-or-improve.md",
      "03-connect-source.md",
      "04-discover-tools.md",
      "05-plan-ui.md",
      "06-design-and-preview.md",
      "07-build.md",
      "08-headless-test.md",
      "09-zip.md",
      "09a-onboarding-iterate.md",
      "10-sync-iterate.md",
      // No stage 11 — the "first real install walk" is gone. Claude
      // Cowork's local-stdio path is broken for view tools, so there's
      // nothing to install locally during build.
      "12-submit.md",
      "design-standards.md",
      "voice-and-gratitude.md",
      "update-mode.md",
    ];
    for (const r of refs) {
      const p = join(PLUGIN_ROOT, "skills", "build", "references", r);
      expect(existsSync(p), `missing references/${r}`).toBe(true);
      // Each reference must be non-trivial.
      expect(statSync(p).size).toBeGreaterThan(200);
    }
  });

  it("ships the stage-9.5 test-persona fixture", () => {
    const fixtureDir = join(
      PLUGIN_ROOT,
      "skills",
      "build",
      "fixtures",
      "test-persona",
    );
    for (const f of ["user.md", "schema/_seed.md", "README.md"]) {
      const p = join(fixtureDir, f);
      expect(existsSync(p), `missing fixtures/test-persona/${f}`).toBe(true);
      expect(
        statSync(p).size,
        `fixtures/test-persona/${f} must be non-trivial`,
      ).toBeGreaterThan(200);
    }
    // The persona user.md must carry the AgntUX user-config frontmatter
    // shape so stage 9.5 can pass it through as a plausible simulated
    // user.md to stage 10.
    const personaBody = readFileSync(join(fixtureDir, "user.md"), "utf-8");
    expect(personaBody).toMatch(/type:\s*user-config/);
    expect(personaBody).toMatch(/discovery_summary:/);
    expect(personaBody).toMatch(/bootstrap_window_days:/);
  });

  it("ships all 9 internal specialist agents", () => {
    const agents = [
      "manifest-author.md",
      "ingest-prompt-author.md",
      "source-semantics-advisor.md",
      "draft-flow-author.md",
      "tests-author.md",
      "view-tool-builder.md",
      "invariant-checker.md",
      "release-checker.md",
      "ui-handler-author.md",
    ];
    for (const a of agents) {
      expect(
        existsSync(join(PLUGIN_ROOT, "agents", a)),
        `missing agents/${a}`,
      ).toBe(true);
    }
  });

  it("ships the canonical UI knowledge layer", () => {
    expect(
      existsSync(join(PLUGIN_ROOT, "canonical", "prompts", "ui")),
    ).toBe(true);
    expect(
      existsSync(join(PLUGIN_ROOT, "canonical", "ui-handlers", "_template")),
    ).toBe(true);
  });

  it("ships the in-plugin host-renderer", () => {
    for (const f of [
      "host-renderer/package.json",
      "host-renderer/README.md",
      "host-renderer/NOTICE",
      "host-renderer/bin/host.mjs",
      "host-renderer/src/server.mjs",
      "host-renderer/src/mcp-bridge.mjs",
      "host-renderer/src/playwright-driver.mjs",
      "host-renderer/src/csp.mjs",
      "host-renderer/public/host.html",
      "host-renderer/public/sandbox.html",
      "host-renderer/public/host-bridge.mjs",
    ]) {
      expect(existsSync(join(PLUGIN_ROOT, f)), `missing ${f}`).toBe(true);
    }
  });

  it("ships the test-harness CLI and points at the in-plugin host", () => {
    const cli = join(PLUGIN_ROOT, "test-harness", "bin", "cli.mjs");
    expect(existsSync(cli)).toBe(true);
    const body = readFileSync(cli, "utf-8");
    expect(body).toMatch(/agntux-build-test/);
  });

  it("voice rules forbid internal jargon in user-facing copy", () => {
    const skillBody = readFileSync(
      join(PLUGIN_ROOT, "skills", "build", "SKILL.md"),
      "utf-8",
    );
    // The skill itself states the forbidden words inline, so we
    // assert that the *forbidding* is present rather than that the
    // words are absent.
    for (const forbidden of [
      "schema",
      "render pipeline",
      "byte-freeze",
      "validator",
      "dispatch",
    ]) {
      expect(
        skillBody.toLowerCase(),
        `voice rule must mention "${forbidden}"`,
      ).toContain(forbidden);
    }
  });

  it("README is written for knowledge workers, not developers", () => {
    const readme = readFileSync(join(PLUGIN_ROOT, "README.md"), "utf-8");
    // Intentionally non-technical phrasing.
    expect(readme.toLowerCase()).toMatch(/knowledge worker|don't need to be a developer/i);
    // Slash command surface is documented.
    expect(readme).toMatch(/\/agntux-build:build/);
  });
});

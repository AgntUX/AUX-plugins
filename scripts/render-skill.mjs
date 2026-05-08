#!/usr/bin/env node
/**
 * render-skill.mjs — render a per-plugin skills/sync/ tree from
 * canonical/prompts/ingest/skills/sync/ + plugins/{slug}/skills/sync/_overrides/.
 *
 * Three composable override mechanisms:
 *   1. Placeholder substitution: _overrides/frontmatter.yaml carries the
 *      {{key}} → value map. Surviving placeholders fail the build.
 *   2. Section-targeted append: <!-- append:{section-id} --> markers in
 *      canonical SKILL.md splice in _overrides/{section-id}-append.md before
 *      the marker line. Marker is stripped after splicing (or if no override
 *      exists for it).
 *   3. Resource wholesale-replace: canonical resources/{name}.md is the
 *      baseline; _overrides/resources/{name}.md replaces it (with
 *      substitution applied). Per-plugin extra resources under
 *      _overrides/resources/ pass through verbatim.
 *
 * CLI:
 *   node scripts/render-skill.mjs <slug>            # render plugins/<slug>/skills/sync/
 *   node scripts/render-skill.mjs --to-stdout <slug># write rendered SKILL.md to stdout
 *   node scripts/render-skill.mjs --self-test       # render canonical with no overrides
 *                                                    (placeholder check relaxed; smoke-tests machinery)
 *   node scripts/render-skill.mjs --canonical <path> --overrides <path> --output <path>
 *                                                    # explicit paths (used by tests/fixtures)
 *
 * Exit codes:
 *   0 — render succeeded
 *   1 — render failed (missing canonical, surviving placeholders, IO error, etc.)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const CANONICAL_SYNC_DIR = join(
  REPO_ROOT,
  "canonical",
  "prompts",
  "ingest",
  "skills",
  "sync",
);

// ── public entry: programmatic use ──────────────────────────────────────────

/**
 * Render a sync skill from canonical + overrides.
 *
 * @param {object} opts
 * @param {string} opts.canonicalDir   absolute path to canonical/.../sync/
 * @param {string} opts.overridesDir   absolute path to plugins/<slug>/skills/sync/_overrides/
 *                                      (may not exist — treated as empty)
 * @param {string} opts.outputDir      absolute path to write SKILL.md + resources/
 * @param {object} [opts.flags]
 * @param {boolean} [opts.flags.allowPlaceholders=false]
 *                                      when true, surviving {{...}} tokens are tolerated
 *                                      (used by --self-test against bare canonical)
 * @returns {{ written: string[], substitutionMap: Record<string,string> }}
 */
export function renderSkill({ canonicalDir, overridesDir, outputDir, flags = {} }) {
  if (!existsSync(canonicalDir)) {
    fail(`canonical sync dir not found: ${canonicalDir}`);
  }
  const canonicalSkill = join(canonicalDir, "SKILL.md");
  if (!existsSync(canonicalSkill)) {
    fail(`canonical SKILL.md not found: ${canonicalSkill}`);
  }

  const subs = loadFrontmatterOverrides(overridesDir);

  // ── render SKILL.md ───────────────────────────────────────────────────────
  let body = readFileSync(canonicalSkill, "utf8");
  body = applyAppendMarkers(body, overridesDir, subs);
  body = applySubstitutions(body, subs);
  if (!flags.allowPlaceholders) {
    assertNoPlaceholders(body, canonicalSkill);
  }

  const written = [];
  ensureDir(outputDir);
  // Wipe prior resources/ to avoid leaving stale files when an override is removed.
  const outResources = join(outputDir, "resources");
  if (existsSync(outResources)) rmSync(outResources, { recursive: true, force: true });

  const outSkill = join(outputDir, "SKILL.md");
  writeFileSync(outSkill, body);
  written.push(outSkill);

  // ── render resources/ ─────────────────────────────────────────────────────
  // Canonical resources first — overridden wholesale if a sibling exists in
  // _overrides/resources/. Per-plugin extras (no canonical counterpart) are
  // copied through afterwards.
  const canonicalResources = join(canonicalDir, "resources");
  const overrideResources = join(overridesDir, "resources");

  const canonicalResNames = existsSync(canonicalResources)
    ? readdirSync(canonicalResources).filter((n) => n.endsWith(".md")).sort()
    : [];
  const overrideResNames = existsSync(overrideResources)
    ? readdirSync(overrideResources).filter((n) => n.endsWith(".md")).sort()
    : [];

  if (canonicalResNames.length || overrideResNames.length) ensureDir(outResources);

  const seen = new Set();
  for (const name of canonicalResNames) {
    seen.add(name);
    let src = readFileSync(
      existsSync(join(overrideResources, name))
        ? join(overrideResources, name)
        : join(canonicalResources, name),
      "utf8",
    );
    src = applySubstitutions(src, subs);
    if (!flags.allowPlaceholders) {
      assertNoPlaceholders(src, `resources/${name}`);
    }
    const out = join(outResources, name);
    writeFileSync(out, src);
    written.push(out);
  }
  for (const name of overrideResNames) {
    if (seen.has(name)) continue; // canonical-overridden already written above
    let src = readFileSync(join(overrideResources, name), "utf8");
    src = applySubstitutions(src, subs);
    if (!flags.allowPlaceholders) {
      assertNoPlaceholders(src, `resources/${name}`);
    }
    const out = join(outResources, name);
    writeFileSync(out, src);
    written.push(out);
  }

  return { written, substitutionMap: subs };
}

// ── core mechanics ──────────────────────────────────────────────────────────

function loadFrontmatterOverrides(overridesDir) {
  const fmPath = join(overridesDir, "frontmatter.yaml");
  if (!existsSync(fmPath)) return {};
  const raw = readFileSync(fmPath, "utf8");
  return parseSimpleYaml(raw);
}

/**
 * Minimal YAML key:value parser for the substitution map.
 * Supports:  key: value          (string scalar, optionally wrapped in single
 *                                  or double quotes)
 *            key: "value with: colons"
 *            key: |              (block scalar — concatenated lines until next key
 *              line one              or dedent to col 0)
 *              line two
 *
 * NOT supported: nested mappings, lists, anchors, flow collections — none of
 * those belong in a flat substitution map.
 */
function parseSimpleYaml(raw) {
  const lines = raw.split(/\r?\n/);
  const out = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || /^\s*#/.test(line)) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    let rest = m[2];
    if (rest === "|" || rest === "|-") {
      // Block scalar — collect indented lines.
      const buf = [];
      i++;
      let indent = -1;
      while (i < lines.length) {
        const l = lines[i];
        if (l.length === 0) {
          buf.push("");
          i++;
          continue;
        }
        const m2 = /^(\s+)(.*)$/.exec(l);
        if (!m2) break;
        if (indent === -1) indent = m2[1].length;
        if (m2[1].length < indent) break;
        buf.push(l.slice(indent));
        i++;
      }
      out[key] = buf.join("\n").replace(/\n+$/, "");
      continue;
    }
    // Strip surrounding quotes if any.
    rest = rest.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");
    out[key] = rest;
    i++;
  }
  return out;
}

function applyAppendMarkers(body, overridesDir, subs) {
  // Splice _overrides/{section-id}-append.md before each
  // <!-- append:{section-id} --> marker line, then strip the marker line.
  // Markers without an override file: strip the marker line silently.
  return body.replace(/^[ \t]*<!--\s*append:([\w-]+)\s*-->[ \t]*\n?/gm, (_match, id) => {
    const overridePath = join(overridesDir, `${id}-append.md`);
    if (!existsSync(overridePath)) return "";
    let snippet = readFileSync(overridePath, "utf8");
    // Substitute now so the snippet's placeholders resolve; we'll re-substitute
    // again when the body-wide pass runs, which is idempotent for already-
    // resolved keys.
    snippet = applySubstitutions(snippet, subs);
    if (!snippet.endsWith("\n")) snippet += "\n";
    return snippet;
  });
}

function applySubstitutions(body, subs) {
  return body.replace(/\{\{([\w-]+)\}\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(subs, key)) return subs[key];
    return m;
  });
}

function assertNoPlaceholders(body, context) {
  const surviving = [...body.matchAll(/\{\{([\w-]+)\}\}/g)].map((m) => m[1]);
  if (surviving.length) {
    const uniq = [...new Set(surviving)];
    fail(
      `surviving {{...}} placeholders in ${context}: ${uniq.join(", ")}\n` +
        `Add the missing keys to _overrides/frontmatter.yaml.`,
    );
  }
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function isMain() {
  return process.argv[1] === __filename;
}

function parseArgs(argv) {
  const out = {
    _: [],
    toStdout: false,
    selfTest: false,
    canonical: null,
    overrides: null,
    output: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--to-stdout") out.toStdout = true;
    else if (a === "--self-test") out.selfTest = true;
    else if (a === "--canonical") out.canonical = argv[++i];
    else if (a === "--overrides") out.overrides = argv[++i];
    else if (a === "--output") out.output = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) fail(`unknown flag: ${a}`);
    else out._.push(a);
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/render-skill.mjs <slug>             render plugins/<slug>/skills/sync/",
    "  node scripts/render-skill.mjs --to-stdout <slug> write SKILL.md to stdout",
    "  node scripts/render-skill.mjs --self-test        smoke-test (canonical, no overrides)",
    "  node scripts/render-skill.mjs --canonical PATH --overrides PATH --output PATH",
    "                                                   explicit paths (tests/fixtures)",
  ].join("\n");
}

function fail(msg) {
  // Throw rather than process.exit so programmatic callers (tests, the
  // build orchestrator's renderSkillsForPlugin) can catch the error.
  // The CLI entry point catches and converts to a non-zero exit.
  throw new RenderSkillError(msg);
}

export class RenderSkillError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "RenderSkillError";
  }
}

if (isMain()) {
  try {
    runCli(process.argv.slice(2));
  } catch (e) {
    if (e instanceof RenderSkillError) {
      console.error(`render-skill: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

function runCli(rawArgs) {
  const args = parseArgs(rawArgs);

  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  if (args.selfTest) {
    // Render canonical with no overrides into a tmp dir; assert it produces
    // output without crashing. Placeholder check relaxed because canonical
    // legitimately carries unresolved placeholders.
    const tmpOut = join(REPO_ROOT, ".render-skill-selftest");
    if (existsSync(tmpOut)) rmSync(tmpOut, { recursive: true, force: true });
    try {
      const r = renderSkill({
        canonicalDir: CANONICAL_SYNC_DIR,
        overridesDir: join(CANONICAL_SYNC_DIR, "_overrides"), // doesn't exist; that's fine
        outputDir: tmpOut,
        flags: { allowPlaceholders: true },
      });
      console.log(
        `render-skill: self-test ok — wrote ${r.written.length} files to ${relative(REPO_ROOT, tmpOut)}`,
      );
      rmSync(tmpOut, { recursive: true, force: true });
      process.exit(0);
    } catch (e) {
      if (existsSync(tmpOut)) rmSync(tmpOut, { recursive: true, force: true });
      throw e;
    }
  }

  if (args.canonical || args.overrides || args.output) {
    if (!args.canonical || !args.overrides || !args.output) {
      fail(
        "explicit-path mode requires all of --canonical, --overrides, --output",
      );
    }
    const r = renderSkill({
      canonicalDir: resolve(args.canonical),
      overridesDir: resolve(args.overrides),
      outputDir: resolve(args.output),
    });
    if (args.toStdout) {
      const skill = r.written.find((p) => p.endsWith("SKILL.md"));
      if (skill) process.stdout.write(readFileSync(skill, "utf8"));
    }
    process.exit(0);
  }

  if (args._.length !== 1) {
    console.error(usage());
    process.exit(1);
  }
  const slug = args._[0];
  const pluginSyncDir = join(REPO_ROOT, "plugins", slug, "skills", "sync");
  const overridesDir = join(pluginSyncDir, "_overrides");
  if (!existsSync(overridesDir)) {
    fail(
      `plugins/${slug}/skills/sync/_overrides/ not found — ` +
        `nothing to render (does the plugin opt into the canonical render pipeline yet?)`,
    );
  }

  if (args.toStdout) {
    // Render to a tmp dir, then read SKILL.md back to stdout (cheaper than
    // refactoring renderSkill to take an "in-memory" mode).
    const tmpOut = join(REPO_ROOT, `.render-skill-stdout-${slug}`);
    if (existsSync(tmpOut)) rmSync(tmpOut, { recursive: true, force: true });
    try {
      renderSkill({
        canonicalDir: CANONICAL_SYNC_DIR,
        overridesDir,
        outputDir: tmpOut,
      });
      process.stdout.write(readFileSync(join(tmpOut, "SKILL.md"), "utf8"));
    } finally {
      if (existsSync(tmpOut)) rmSync(tmpOut, { recursive: true, force: true });
    }
    process.exit(0);
  }

  const r = renderSkill({
    canonicalDir: CANONICAL_SYNC_DIR,
    overridesDir,
    outputDir: pluginSyncDir,
  });
  console.log(
    `render-skill: ${slug} — wrote ${r.written.length} files (` +
      r.written.map((p) => relative(REPO_ROOT, p)).join(", ") +
      `)`,
  );
}

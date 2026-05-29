#!/usr/bin/env node
/**
 * render-skill.mjs — render a per-plugin skills/{slug}/ tree from
 * canonical/prompts/ingest/skills/sync/ + plugins/{slug}/skills/{slug}/_overrides/.
 *
 * (The canonical parent directory is still named `sync/` because it's
 * internal-only; the rendered output is named after the plugin slug so the
 * host exposes it as `/{slug}` and the skill's `name:` matches the slug.)
 *
 * Three composable override mechanisms:
 *   1. Placeholder substitution: _overrides/frontmatter.yaml carries the
 *      {{key}} → value map. Surviving placeholders fail the build.
 *   2. Section-targeted append: <!-- append:{section-id} --> markers in
 *      canonical SKILL.md AND every canonical reference/*.md file splice in
 *      _overrides/{section-id}-append.md before the marker line. Marker is
 *      stripped after splicing (or if no override exists for it).
 *   3. Reference wholesale-replace: canonical reference/{name}.md is the
 *      baseline; _overrides/reference/{name}.md replaces it (with
 *      substitution applied). Per-plugin extra references under
 *      _overrides/reference/ pass through verbatim.
 *
 * CLI:
 *   node scripts/render-skill.mjs <slug>            # render plugins/<slug>/skills/<slug>/
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
 * @param {string} opts.overridesDir   absolute path to plugins/<slug>/skills/<slug>/_overrides/
 *                                      (may not exist — treated as empty)
 * @param {string} opts.outputDir      absolute path to write SKILL.md + reference/
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
  // Wipe prior reference/ to avoid leaving stale files when an override is removed.
  const outRef = join(outputDir, "reference");
  if (existsSync(outRef)) rmSync(outRef, { recursive: true, force: true });

  const outSkill = join(outputDir, "SKILL.md");
  writeFileSync(outSkill, body);
  written.push(outSkill);

  // ── render reference/ ─────────────────────────────────────────────────────
  // Canonical reference files first — overridden wholesale if a sibling exists
  // in _overrides/reference/. Per-plugin extras (no canonical counterpart) are
  // copied through afterwards. Append markers are processed in every reference
  // file too, because the procedural body that used to live in canonical
  // SKILL.md now lives in canonical reference/sync.md and still carries
  // <!-- append:step-* --> markers.
  const canonicalRef = join(canonicalDir, "reference");
  const overrideRef = join(overridesDir, "reference");

  const canonicalRefNames = existsSync(canonicalRef)
    ? readdirSync(canonicalRef).filter((n) => n.endsWith(".md")).sort()
    : [];
  const overrideRefNames = existsSync(overrideRef)
    ? readdirSync(overrideRef).filter((n) => n.endsWith(".md")).sort()
    : [];

  if (canonicalRefNames.length || overrideRefNames.length) ensureDir(outRef);

  const seen = new Set();
  for (const name of canonicalRefNames) {
    seen.add(name);
    let src = readFileSync(
      existsSync(join(overrideRef, name))
        ? join(overrideRef, name)
        : join(canonicalRef, name),
      "utf8",
    );
    src = applyAppendMarkers(src, overridesDir, subs);
    src = applySubstitutions(src, subs);
    if (!flags.allowPlaceholders) {
      assertNoPlaceholders(src, `reference/${name}`);
    }
    const out = join(outRef, name);
    writeFileSync(out, src);
    written.push(out);
  }
  for (const name of overrideRefNames) {
    if (seen.has(name)) continue; // canonical-overridden already written above
    let src = readFileSync(join(overrideRef, name), "utf8");
    src = applyAppendMarkers(src, overridesDir, subs);
    src = applySubstitutions(src, subs);
    if (!flags.allowPlaceholders) {
      assertNoPlaceholders(src, `reference/${name}`);
    }
    const out = join(outRef, name);
    writeFileSync(out, src);
    written.push(out);
  }

  return { written, substitutionMap: subs };
}

/**
 * Validate a plugin's `_overrides/frontmatter.yaml` WITHOUT rendering any
 * files. Runs the override-frontmatter validation half of the render
 * pipeline: confirms the yaml exists, is well-formed, and that a canonical
 * render would leave no surviving `{{...}}` placeholders. This is the
 * `--validate-overrides` flag's core (WS-A.4) — a fast pre-flight the
 * agntux-build specialists and the worker's Track-B revise can run to prove
 * the overrides are complete before a full build.
 *
 * @param {object} opts
 * @param {string} opts.canonicalDir  absolute path to canonical/.../sync/
 * @param {string} opts.overridesDir  absolute path to .../_overrides/
 * @returns {{ ok: boolean, reason?: string, detail?: string, surviving: string[] }}
 *   ok=true → frontmatter.yaml is present, well-formed, and resolves every
 *   canonical placeholder. ok=false → `reason` is one of `missing`, `empty`,
 *   `no-canonical`, `surviving-placeholders` (plus `malformed` as a defensive
 *   branch — the current `parseSimpleYaml` is non-throwing, so an unparseable
 *   map surfaces in practice as `empty` or `surviving-placeholders`); `detail`
 *   names the specific problem (e.g. the missing keys), `surviving` lists any
 *   unresolved placeholder keys.
 */
export function validateOverrides({ canonicalDir, overridesDir }) {
  const fmPath = join(overridesDir, "frontmatter.yaml");
  if (!existsSync(fmPath)) {
    return {
      ok: false,
      reason: "missing",
      detail: `_overrides/frontmatter.yaml not found at ${fmPath}`,
      surviving: [],
    };
  }

  let subs;
  try {
    subs = parseSimpleYaml(readFileSync(fmPath, "utf8"));
  } catch (e) {
    return {
      ok: false,
      reason: "malformed",
      detail: `cannot parse frontmatter.yaml: ${e.message}`,
      surviving: [],
    };
  }
  if (!subs || Object.keys(subs).length === 0) {
    return {
      ok: false,
      reason: "empty",
      detail: "frontmatter.yaml parsed to zero keys",
      surviving: [],
    };
  }

  const canonicalSkill = join(canonicalDir, "SKILL.md");
  if (!existsSync(canonicalSkill)) {
    return {
      ok: false,
      reason: "no-canonical",
      detail: `canonical SKILL.md not found: ${canonicalSkill}`,
      surviving: [],
    };
  }

  // Collect every canonical surface (SKILL.md + reference/*.md), prefer the
  // override replacement when one exists, dry-render in memory, and gather
  // surviving placeholders. Mirrors renderSkill's file selection exactly so
  // the validation result matches what an actual render would produce.
  const overrideRef = join(overridesDir, "reference");
  const survivingSet = new Set();

  const renderOne = (srcPath) => {
    let src = readFileSync(srcPath, "utf8");
    src = applyAppendMarkers(src, overridesDir, subs);
    src = applySubstitutions(src, subs);
    for (const m of src.matchAll(/\{\{([\w-]+)\}\}/g)) survivingSet.add(m[1]);
  };

  // SKILL.md
  renderOne(canonicalSkill);

  // canonical reference/*.md (override-replaced where present)
  const canonicalRef = join(canonicalDir, "reference");
  const canonicalRefNames = existsSync(canonicalRef)
    ? readdirSync(canonicalRef).filter((n) => n.endsWith(".md")).sort()
    : [];
  for (const name of canonicalRefNames) {
    const overridePath = join(overrideRef, name);
    renderOne(existsSync(overridePath) ? overridePath : join(canonicalRef, name));
  }

  // per-plugin extra reference files (no canonical counterpart)
  if (existsSync(overrideRef)) {
    const seen = new Set(canonicalRefNames);
    for (const name of readdirSync(overrideRef).filter((n) => n.endsWith(".md")).sort()) {
      if (seen.has(name)) continue;
      renderOne(join(overrideRef, name));
    }
  }

  const surviving = [...survivingSet].sort();
  if (surviving.length) {
    return {
      ok: false,
      reason: "surviving-placeholders",
      detail: `unresolved placeholders (add to frontmatter.yaml): ${surviving.join(", ")}`,
      surviving,
    };
  }

  return { ok: true, surviving: [] };
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
    validateOverrides: false,
    canonical: null,
    overrides: null,
    output: null,
    pluginDir: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--to-stdout") out.toStdout = true;
    else if (a === "--self-test") out.selfTest = true;
    else if (a === "--validate-overrides") out.validateOverrides = true;
    else if (a === "--canonical") out.canonical = argv[++i];
    else if (a === "--overrides") out.overrides = argv[++i];
    else if (a === "--output") out.output = argv[++i];
    else if (a === "--plugin-dir") out.pluginDir = argv[++i];
    else if (a.startsWith("--plugin-dir=")) out.pluginDir = a.slice("--plugin-dir=".length);
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) fail(`unknown flag: ${a}`);
    else out._.push(a);
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/render-skill.mjs <slug>             render plugins/<slug>/skills/<slug>/",
    "  node scripts/render-skill.mjs --to-stdout <slug> write SKILL.md to stdout",
    "  node scripts/render-skill.mjs --self-test        smoke-test (canonical, no overrides)",
    "  node scripts/render-skill.mjs --validate-overrides <slug>",
    "                                                   check _overrides/frontmatter.yaml resolves (no render)",
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
  // --plugin-dir points at the plugin tree directly (the contributor build
  // sandbox, where there is no marketplace clone); otherwise default to the
  // clone's plugins/<slug>. CANONICAL_SYNC_DIR resolves from this script's own
  // location, so it is correct in both the clone (<repo>/canonical/…) and the
  // bundle (<plugin>/canonical/…) with no flag.
  const pluginSkillDir = args.pluginDir
    ? join(resolve(args.pluginDir), "skills", slug)
    : join(REPO_ROOT, "plugins", slug, "skills", slug);
  const overridesDir = join(pluginSkillDir, "_overrides");

  // --validate-overrides: check frontmatter.yaml only; do not render anything.
  // Exit 0 when the overrides resolve every canonical placeholder; exit 1
  // (naming the offending keys) otherwise.
  if (args.validateOverrides) {
    const result = validateOverrides({
      canonicalDir: CANONICAL_SYNC_DIR,
      overridesDir,
    });
    if (result.ok) {
      console.log(
        `render-skill: ${slug} — _overrides/frontmatter.yaml valid (canonical render resolves cleanly)`,
      );
      process.exit(0);
    }
    console.error(`render-skill: ${slug} — overrides invalid [${result.reason}]: ${result.detail}`);
    process.exit(1);
  }

  if (!existsSync(overridesDir)) {
    fail(
      `plugins/${slug}/skills/${slug}/_overrides/ not found — ` +
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
    outputDir: pluginSkillDir,
  });
  console.log(
    `render-skill: ${slug} — wrote ${r.written.length} files (` +
      r.written.map((p) => relative(REPO_ROOT, p)).join(", ") +
      `)`,
  );
}

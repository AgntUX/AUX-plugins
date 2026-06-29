#!/usr/bin/env node
/**
 * affected.mjs — single source of truth for "which plugins did this change touch,
 * and is the change broad enough that we must run the FULL suite anyway?"
 *
 * Why this exists
 * ---------------
 * Every required PR check (test / lint / version-check / build-verify) historically
 * ran repo-wide: `npm test` runs vitest across ALL plugins, `build-plugin.mjs --all`
 * builds every plugin, `lint:marketplace` lints them all. So a stale assertion in
 * plugin Y (e.g. a hard-coded version literal that drifted on a bump) turned a
 * repo-wide check red and blocked an unrelated, clean PR for plugin X — even though
 * the submission handler had already validated X scoped. This computes the affected
 * plugin set so each check can run scoped to what actually changed, falling back to
 * the full suite the moment a SHARED root (canonical/, packages/, scripts/, lib/,
 * vitest.config.ts, .github/, root configs) changes — because a shared change can
 * break any plugin.
 *
 * Fail-safe posture: when the git diff can't be computed (no base ref, detached
 * HEAD, parse error) or any changed path falls outside a recognizable
 * `plugins/<slug>/…` shape (including a slug with shell-hostile characters — an
 * Actions-injection guard), we return mode "full". Over-running is always safe;
 * under-running is the only dangerous direction.
 *
 * Usage (CLI, consumed by the workflows):
 *   node scripts/affected.mjs mode        # prints "full" | "scoped"
 *   node scripts/affected.mjs plugins     # prints space-separated affected slugs
 *   node scripts/affected.mjs --json      # prints { mode, plugins } as JSON
 *   node scripts/affected.mjs --base <ref> --head <ref> [...]   # override refs
 *
 * Ref defaults: --base → $GITHUB_BASE_REF (as origin/<ref>, PR context) else
 * HEAD~1; --head → HEAD. A `--changed-files <newline-list>` flag bypasses git
 * entirely (used by the unit tests and any caller that already has the diff).
 */

import { spawnSync } from "node:child_process";

// A plugin slug is a lowercase dns-ish label. Anything outside this charset is
// rejected (→ full mode) so a hostile branch can never inject shell metachars
// through a `plugins/<weird>/` path into a workflow `run:` step.
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

// Top-level path segments that are NOT a single plugin: a change under any of
// them can affect every plugin, so it forces the full suite. (Anything that is
// not `plugins/<slug>/…` is treated as shared by computeAffected — this list is
// documentary; the logic keys off the `plugins/` prefix, not this set.)
export const SHARED_ROOTS = [
  "canonical",
  "packages",
  "scripts",
  "lib",
  "vitest.config.ts",
  ".github",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];

/**
 * Pure core: given the list of changed repo-relative paths, return
 * `{ mode, plugins }`. `mode` is "full" when any changed path is not a
 * `plugins/<valid-slug>/…` file (a shared/cross-cutting change, or an
 * unrecognizable/hostile path); otherwise "scoped" with the sorted, de-duped set
 * of affected slugs. An empty change list → scoped with no plugins (the caller
 * then runs only the always-on shared test dirs, which is correct).
 */
export function computeAffected(changedPaths) {
  const plugins = new Set();
  let shared = false;
  for (const raw of changedPaths) {
    const p = String(raw).trim();
    if (!p) continue;
    const m = /^plugins\/([^/]+)\/.+/.exec(p);
    if (!m) {
      // Not a file inside a plugin dir (root file, shared dir, or a bare
      // `plugins/<file>` with no slug subdir) → broad change → full.
      shared = true;
      continue;
    }
    const slug = m[1];
    if (!SLUG_RE.test(slug)) {
      // Unrecognizable / shell-hostile slug → don't emit it; run full (safe).
      shared = true;
      continue;
    }
    plugins.add(slug);
  }
  if (shared) return { mode: "full", plugins: [] };
  return { mode: "scoped", plugins: [...plugins].sort() };
}

/** Run a git command; return trimmed stdout or null on any failure. */
function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.error || r.status !== 0 || typeof r.stdout !== "string") return null;
  return r.stdout;
}

/** A git all-zero SHA (40 or 64 hex zeros) — github.event.before on a branch
 * create or after a force-push that has no prior commit. Never a valid base. */
function isZeroSha(s) {
  return typeof s === "string" && /^0+$/.test(s);
}

/**
 * Resolve the changed-path list from git. The base commit is taken from EXPLICIT
 * event SHAs, never inferred from `HEAD~1`:
 *   - `--base` override (tests / manual);
 *   - PR:   `GITHUB_PR_BASE_SHA` (github.event.pull_request.base.sha) — the exact
 *           base commit, so this does NOT depend on a remote-tracking `origin/<base>`
 *           ref being fetched; then the `origin/<base>` ref as a secondary;
 *   - push: `GITHUB_EVENT_BEFORE` (github.event.before) — the SHA BEFORE the push,
 *           so a MULTI-commit push diffs across ALL its commits (using `HEAD~1`
 *           here would silently scope out every commit but the last — the one
 *           direction this module must never take).
 * When NONE of these is available/usable, return null so the caller runs the FULL
 * suite (strictly safe). The all-zero SHA (branch create / initial force-push) is
 * skipped → full. Tries three-dot (PR's own changes since the merge-base) then
 * two-dot per candidate; first that git can resolve wins.
 */
export function changedPathsFromGit({ base, head = "HEAD" } = {}) {
  const candidates = [];
  if (base) candidates.push(base);
  // PR: the exact base commit SHA from the event payload (no ref-fetch dependency).
  const prBaseSha = process.env.GITHUB_PR_BASE_SHA;
  if (prBaseSha && !isZeroSha(prBaseSha)) candidates.push(prBaseSha);
  // PR secondary: the base branch as a remote-tracking ref (works when fetched).
  if (process.env.GITHUB_BASE_REF) candidates.push(`origin/${process.env.GITHUB_BASE_REF}`);
  // push: the pre-push SHA — covers every commit in a multi-commit push.
  const before = process.env.GITHUB_EVENT_BEFORE;
  if (before && !isZeroSha(before)) candidates.push(before);

  for (const b of candidates) {
    // three-dot: changes on <head> since the merge-base with <b> (the PR's own
    // changes, excluding what landed on the base meanwhile).
    let out = git(["diff", "--name-only", `${b}...${head}`]);
    if (out == null) out = git(["diff", "--name-only", b, head]); // two-dot fallback
    if (out != null) return out.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  // No usable base → caller runs FULL. We deliberately do NOT fall back to
  // `HEAD~1`: a valid-looking but wrong base is how a diff silently UNDER-tests,
  // and under-testing is the only unsafe direction.
  return null;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
      else {
        out[a.slice(2)] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);

  let changed;
  if (typeof args["changed-files"] === "string") {
    changed = args["changed-files"].split("\n").map((s) => s.trim()).filter(Boolean);
  } else {
    changed = changedPathsFromGit({ base: args.base, head: args.head });
  }

  // Fail-safe: no diff available → full.
  const result =
    changed == null ? { mode: "full", plugins: [] } : computeAffected(changed);

  const verb = args._[0];
  if (args.json) {
    process.stdout.write(JSON.stringify(result));
  } else if (verb === "plugins") {
    process.stdout.write(result.plugins.join(" "));
  } else {
    // default + "mode"
    process.stdout.write(result.mode);
  }
  process.stdout.write("\n");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}

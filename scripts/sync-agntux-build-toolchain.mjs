#!/usr/bin/env node
/**
 * sync-agntux-build-toolchain.mjs — vendor the build/validate toolchain into the
 * agntux-build plugin bundle (A1/E1).
 *
 * The plugin ships the toolchain so a contributor with NO marketplace clone can
 * still build + validate a plugin in their sandbox: bin/ entrypoints, scripts/
 * helpers, the built @agntux/* packages, the canonical ingest sync templates,
 * the scaffold's canonical assets, and a small "repo-mirror" of the apps-client
 * canonical that lint pass 12 compares against. These are TRACKED ARTIFACTS
 * derived from the repo-root sources — never hand-edit a bundled copy; edit the
 * source under scripts/ | packages/ | canonical/ and re-run this script.
 *
 * The repo-root sources are the single source of truth; this script (run by the
 * maintainer / CI / on version bump) keeps the bundle in sync, and `--check`
 * fails when the bundle has drifted (the E1 guard) — wired into CI and a vitest.
 *
 * Usage:
 *   node scripts/sync-agntux-build-toolchain.mjs           # write the bundle
 *   node scripts/sync-agntux-build-toolchain.mjs --check   # verify, exit 1 on drift
 *
 * Exit codes: 0 ok · 1 drift (in --check) · 2 build/IO error
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const BUNDLE = join(REPO_ROOT, "plugins", "agntux-build");

// REQUIRED_FILES from scripts/lint/lint-apps-client-drift.ts — the only
// apps-client files pass 12 hashes. The repo-mirror carries just these, at
// their repo-relative paths, so the bundled linter resolves them via
// --apps-client-canonical-root.
const APPS_CLIENT_REQUIRED = ["simple-mcp-app.ts", "constants.ts"];
const APPS_CLIENT_CANONICAL_REL =
  "plugins/agntux-core/view-tool/src/lib/apps-client";

// ── manifest ─────────────────────────────────────────────────────────────────

/** Single-file copies: [repo-relative src, bundle-relative dest]. */
function fileCopies() {
  const copies = [
    // bin/ entrypoints (on the Bash PATH while the plugin is enabled)
    ["scripts/validate-plugin.mjs", "bin/validate-plugin.mjs"],
    ["scripts/build-plugin.mjs", "bin/build-plugin.mjs"],
    // toolchain-layout is imported relatively by both bin/ entrypoints AND the
    // scripts/ helpers, so it lives in both dirs.
    ["scripts/toolchain-layout.mjs", "bin/toolchain-layout.mjs"],
    ["scripts/toolchain-layout.mjs", "scripts/toolchain-layout.mjs"],
    // scripts/ helpers the entrypoints / flow invoke
    ["scripts/render-skill.mjs", "scripts/render-skill.mjs"],
    ["scripts/check-view-tool-imports.mjs", "scripts/check-view-tool-imports.mjs"],
    ["scripts/scaffold-marketplace-assets.mjs", "scripts/scaffold-marketplace-assets.mjs"],
    // scaffold canonical assets
    [
      "canonical/marketplace-assets/icon.placeholder.png",
      "canonical/marketplace-assets/icon.placeholder.png",
    ],
    [
      "canonical/skills/_overrides/frontmatter.template.yaml",
      "canonical/skills/_overrides/frontmatter.template.yaml",
    ],
    // (built @agntux/* package manifests are vendored via transformPackageJson
    //  below — their lifecycle scripts must be stripped, see main())
  ];
  // apps-client repo-mirror (pass 12). ONLY the agntux-core canonical is
  // mirrored: pass 12's EXTRA_COPIES check (the agntux-build _template copy) is
  // gated on `pluginSlug === "agntux-build"`, which never fires in the bundle
  // (it only ever lints CONTRIBUTOR plugins), so that copy is dead weight here —
  // and mirroring it at its full repo-relative path pushed the tree to 11
  // folders deep, past Claude Desktop's 10-folder zip-upload limit.
  for (const name of APPS_CLIENT_REQUIRED) {
    copies.push([
      `${APPS_CLIENT_CANONICAL_REL}/${name}`,
      `canonical/repo-mirror/${APPS_CLIENT_CANONICAL_REL}/${name}`,
    ]);
  }
  return copies;
}

/** Recursive dir copies: [repo-relative srcDir, bundle-relative destDir]. */
const DIR_COPIES = [
  ["packages/agntux-ui-primitives/dist", "canonical/packages/agntux-ui-primitives/dist"],
  ["packages/plugin-runtime/dist", "canonical/packages/plugin-runtime/dist"],
  ["canonical/prompts/ingest/skills/sync", "canonical/prompts/ingest/skills/sync"],
];

// The esbuild-compiled, self-contained linter (no TS runtime in the sandbox).
const LINT_DEST_REL = "scripts/lint-marketplace-metadata.mjs";

// Built @agntux/* packages vendored into the bundle: [pkg dir name].
const VENDORED_PACKAGES = ["agntux-ui-primitives", "plugin-runtime"];

/**
 * Transform a package.json for in-bundle vendoring. The dist is pre-built and
 * shipped, so a contributor's `npm install` of the file: dep must NOT try to
 * rebuild it: strip `scripts` (the `prepare`/`build` = `tsc` lifecycle would
 * run on install and fail — `tsc: command not found` in the sandbox) and
 * `devDependencies` (build-only, never needed to consume the dist). Keep the
 * resolution surface (main/types/exports/files) and the runtime
 * dependencies/peerDependencies.
 */
export function transformPackageJson(raw) {
  const pkg = JSON.parse(raw);
  delete pkg.scripts;
  delete pkg.devDependencies;
  return JSON.stringify(pkg, null, 2) + "\n";
}

// ── esbuild: compile the linter to a self-contained .mjs ─────────────────────

/**
 * Compile lint-marketplace-metadata.ts (+ lint/ + lib/marketplace-schema, with
 * js-yaml / image-size / zod inlined) to a single ESM file. render-skill.mjs is
 * kept EXTERNAL — it ships separately in scripts/ and has its own
 * import.meta.url main-guard that must not fire when bundled.
 */
async function compileLinter() {
  // Map TS's `.js` import specifiers (NodeNext) back onto the `.ts` source.
  const tsForJs = {
    name: "ts-for-js",
    setup(build) {
      build.onResolve({ filter: /\.js$/ }, (args) => {
        if (!args.path.startsWith(".")) return undefined;
        const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
        return existsSync(tsPath) ? { path: tsPath } : undefined;
      });
    },
  };
  // render-skill.mjs stays external; rewrite the specifier to the sibling it
  // will live next to in scripts/.
  const externalRenderSkill = {
    name: "external-render-skill",
    setup(build) {
      build.onResolve({ filter: /render-skill\.mjs$/ }, () => ({
        path: "./render-skill.mjs",
        external: true,
      }));
    },
  };

  const result = await esbuild.build({
    entryPoints: [join(REPO_ROOT, "scripts", "lint-marketplace-metadata.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false,
    legalComments: "none",
    plugins: [externalRenderSkill, tsForJs],
    banner: {
      js: "// GENERATED by scripts/sync-agntux-build-toolchain.mjs — do not edit.\n// Source: scripts/lint-marketplace-metadata.ts (+ scripts/lint/, lib/marketplace-schema.ts).",
    },
  });
  return result.outputFiles[0].text;
}

// ── fs helpers ───────────────────────────────────────────────────────────────

function listFilesRec(dir, base = dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) listFilesRec(full, base, acc);
    else if (e.isFile()) acc.push(relative(base, full));
  }
  return acc;
}

function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ── run ──────────────────────────────────────────────────────────────────────

async function main() {
  const check = process.argv.includes("--check");
  const drift = [];

  // 1. single-file copies
  for (const [srcRel, destRel] of fileCopies()) {
    const src = join(REPO_ROOT, srcRel);
    const dest = join(BUNDLE, destRel);
    if (!existsSync(src)) {
      console.error(`sync-toolchain: missing source ${srcRel}`);
      process.exit(2);
    }
    syncFile(readFileSync(src), dest, destRel, check, drift);
  }

  // 2. recursive dir copies (also detect stale extra files in dest)
  for (const [srcRel, destRel] of DIR_COPIES) {
    const srcDir = join(REPO_ROOT, srcRel);
    const destDir = join(BUNDLE, destRel);
    if (!existsSync(srcDir)) {
      console.error(`sync-toolchain: missing source dir ${srcRel}`);
      process.exit(2);
    }
    const srcFiles = new Set(listFilesRec(srcDir));
    for (const rel of srcFiles) {
      syncFile(readFileSync(join(srcDir, rel)), join(destDir, rel), `${destRel}/${rel}`, check, drift);
    }
    // stale files present in dest but not in src
    if (existsSync(destDir)) {
      for (const rel of listFilesRec(destDir)) {
        if (!srcFiles.has(rel)) {
          drift.push(`stale: ${destRel}/${rel}`);
          if (!check) rmSync(join(destDir, rel), { force: true });
        }
      }
    }
  }

  // 3. vendored package manifests (lifecycle scripts stripped so a
  //    contributor's npm install of the file: dep never rebuilds the package)
  for (const name of VENDORED_PACKAGES) {
    const srcPkg = join(REPO_ROOT, "packages", name, "package.json");
    if (!existsSync(srcPkg)) {
      console.error(`sync-toolchain: missing source package ${name}/package.json`);
      process.exit(2);
    }
    const transformed = transformPackageJson(readFileSync(srcPkg, "utf8"));
    syncFile(
      Buffer.from(transformed, "utf8"),
      join(BUNDLE, "canonical", "packages", name, "package.json"),
      `canonical/packages/${name}/package.json`,
      check,
      drift,
    );
  }

  // 4. compiled linter
  let linterText;
  try {
    linterText = await compileLinter();
  } catch (e) {
    console.error(`sync-toolchain: linter compile failed: ${e.message}`);
    process.exit(2);
  }
  syncFile(Buffer.from(linterText, "utf8"), join(BUNDLE, LINT_DEST_REL), LINT_DEST_REL, check, drift);

  if (check) {
    if (drift.length) {
      console.error(
        `sync-toolchain: bundle DRIFT (${drift.length}) — run \`npm run sync:agntux-build-toolchain\`:`,
      );
      for (const d of drift.slice(0, 40)) console.error(`  - ${d}`);
      if (drift.length > 40) console.error(`  … and ${drift.length - 40} more`);
      process.exit(1);
    }
    console.log("sync-toolchain: bundle is in sync ✓");
    process.exit(0);
  }
  console.log(`sync-toolchain: wrote agntux-build bundle (${drift.length} change(s)).`);
  process.exit(0);
}

/** Write or compare a single file. Records drift; writes when not --check. */
function syncFile(buf, destAbs, destRel, check, drift) {
  const existing = existsSync(destAbs) ? readFileSync(destAbs) : null;
  const same = existing && sha(existing) === sha(buf);
  if (same) return;
  drift.push(existing ? `changed: ${destRel}` : `missing: ${destRel}`);
  if (!check) {
    mkdirSync(dirname(destAbs), { recursive: true });
    writeFileSync(destAbs, buf);
  }
}

main();

---
description: Build plugins and produce .zip files suitable for manual upload to Claude Desktop (Settings → Plugins → Add plugins → Upload a file)
argument-hint: <slug>... | --all [--skip-build] [--out <dir>]
allowed-tools: Bash(node scripts/package-plugins.mjs *), Bash(ls dist-zips/*), Bash(unzip -l *), Read
---

Build the requested plugin(s) and produce per-plugin `.zip` archives in
`dist-zips/{slug}-{version}.zip` for manual upload via Claude Desktop or
local install via `claude --plugin-dir <zip-path>`.

```
node scripts/package-plugins.mjs $ARGUMENTS
```

## Why this exists

The marketplace install path (`/plugin marketplace add
https://github.com/AgntUX/AUX-plugins`) is the supported flow. This
slash command is the **fallback when the host's marketplace UI is
broken**: it lets the user upload plugins manually one-by-one, which
Claude Desktop's Org Settings → Plugins surface accepts as `.zip`
files up to 50 MB each.

## What the script does

1. Runs `scripts/build-plugin.mjs <slug>...` first (skip with `--skip-build`)
   so dist/ outputs are current — the zip only ships compiled artifacts,
   never source.
2. Zips each plugin with `.claude-plugin/plugin.json` at the **zip root**
   (no wrapper folder — required by Claude Desktop's upload validator).
3. Excludes `node_modules/`, `src/`, `__tests__/`, `examples/`,
   `_overrides/`, test files, lockfiles, and editor cruft.
4. Validates each zip with `zip -T`, confirms the manifest is at the root,
   and hard-fails if any zip exceeds the 50 MB upload cap.

## Format (sourced from code.claude.com/docs/en/plugins-reference)

- **Extension**: `.zip` only. The `.plugin` extension that Cowork's
  customizer outputs is rejected by Claude Desktop's upload dialog
  (anthropics/claude-code#28337, #40414).
- **Layout**: standard plugin tree at zip root —
  `.claude-plugin/plugin.json`, `skills/`, `hooks/`, `mcp-server/dist/`,
  `view-tool/dist/`, `LICENSE`, `README.md`, `CHANGELOG.md`. Don't put
  `skills/` or `hooks/` inside `.claude-plugin/`.
- **Size**: ≤ 50 MB per zip.

## Examples

Package a single plugin:
```
node scripts/package-plugins.mjs agntux-core
```

Package everything:
```
node scripts/package-plugins.mjs --all
```

Skip the build step (dist/ already current):
```
node scripts/package-plugins.mjs --all --skip-build
```

Custom output location:
```
node scripts/package-plugins.mjs agntux-core --out /tmp/my-zips
```

## When to use this

- The user says "I can't install via the marketplace — make me zips I can
  upload manually".
- The user wants to test a plugin locally with
  `claude --plugin-dir ./dist-zips/{slug}-{version}.zip`.
- The user is preparing a one-off distribution outside the marketplace.

## When NOT to use this

- Normal install: the user should use `/plugin marketplace add` against
  this repo and `/plugin install <slug>@agntux`.
- CI distribution: `.github/workflows/build-plugins.yml` already commits
  dist/ artifacts back; consumers get a runnable plugin at any pinned SHA.

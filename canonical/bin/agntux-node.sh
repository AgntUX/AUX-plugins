#!/bin/sh
# agntux-node.sh — shared Node launcher for AgntUX plugins (macOS).
#
# SINGLE SOURCE OF TRUTH: AUX-plugins/canonical/bin/agntux-node.sh
#   - synced into plugins/agntux-build/bin/agntux-node.sh by
#     scripts/sync-agntux-build-toolchain.mjs (tracked, drift-guarded)
#   - copied verbatim into plugins/agntux-core/bin/agntux-node.sh
# Edit ONLY this file; re-run the sync + re-copy. The launcher.test.mjs in
# each plugin pins the two copies byte-identical to this source.
#
# WHY THIS EXISTS
# ---------------
# Claude Desktop runs a plugin's MCP server (.mcp.json `command`) and its
# `command` hooks as HOST processes — it does NOT provide a Node runtime. A
# non-technical user has no `node`/`npm` on PATH, so `command: "node"` fails
# with "tools unavailable." The mandatory AgntUX desktop app, however, ships a
# modern Node engine (Electron-as-node) and a bundled npm. It publishes both
# paths in a marker at:
#     ~/Library/Application Support/AgntUX/electron-runtime.json
# This launcher resolves that runtime and re-execs the requested script under
# it, so both plugins run with ZERO user-installed Node.
#
# CONTRACT
# --------
#   invoked as:  sh agntux-node.sh <script.(m)js> [args...]
#   resolution order:
#     1. the app marker (electronPath, codesign-verified)
#     2. a fallback probe of /Applications + ~/Applications for *AgntUX*.app
#     3. a system `node` on PATH (dev / power-user machines)
#   on success it execs the runtime, exporting for the child:
#     AGNTUX_ELECTRON      — the resolved Electron binary (empty under #3)
#     AGNTUX_NPM_CLI       — the bundled npm-cli.js, inside the verified bundle
#     ELECTRON_RUN_AS_NODE — "1" when execing Electron (makes it a Node)
#   agntux-build's MCP server reads AGNTUX_ELECTRON/AGNTUX_NPM_CLI to build an
#   npm/npx PATH shim; agntux-core (node-only) needs nothing more.
#
# SECURITY: the marker lives in a user-writable dir, so electronPath/npmCliPath
# are UNTRUSTED input. We bind to the app's Developer ID *identity* via codesign
# (Team ID + bundle id), never to a forgeable path shape — a look-alike planted
# in an attacker-owned "*.app" fails codesign. `codesign --verify --strict` also
# re-hashes the whole bundle seal (incl. Contents/Resources/npm), so a tampered
# bundled npm is rejected too. The marker PRODUCER is
# agntux-teams/src/main/runtime-marker.ts — it MUST emit pretty-printed
# (2-space) JSON for marker_str's per-line extraction below.

set -eu

MARKER="${HOME}/Library/Application Support/AgntUX/electron-runtime.json"

# The genuine AgntUX desktop app's Developer ID signing identity. The marker
# lives in a user-writable dir, so its electronPath is UNTRUSTED input — we bind
# the runtime to this signed identity (codesign), never to a forgeable path.
AGNTUX_TEAM_ID="K6B5DNTSS7"
AGNTUX_BUNDLE_ID="ai.agntux.teams"

ELECTRON=""
NPM_CLI=""

# ── extract one top-level string value from the pretty-printed marker ─────────
# The marker is JSON.stringify(obj, null, 2): `  "key": "value",`. Capturing
# between the quotes tolerates spaces in the path. A JSON null (unquoted) or a
# missing key yields the empty string.
marker_str() {
  # $1 = key
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\\(.*\\)\".*/\\1/p" "$MARKER" 2>/dev/null | head -n1
}

# ── verify a candidate is the GENUINE, signed AgntUX runtime ──────────────────
# Identity (codesign Developer ID Team ID + bundle id), not path shape, is the
# trust anchor — a look-alike in an attacker-owned "*.app" cannot forge it.
# `--verify --strict` re-hashes the whole bundle seal, so a tampered bundled npm
# under Contents/Resources is caught too. ~30ms; negligible vs the
# Electron-as-Node start it gates. A dev/unsigned Electron fails this on purpose
# and falls through to the system-node path (a developer has node).
valid_runtime() {
  # $1 = candidate path
  p="$1"
  [ -n "$p" ] || return 1
  [ -f "$p" ] || return 1
  [ -x "$p" ] || return 1
  case "$p" in
    *.app/Contents/MacOS/*) ;;
    *) return 1 ;;
  esac
  command -v codesign >/dev/null 2>&1 || return 1
  bundle=${p%/Contents/MacOS/*}
  [ -d "$bundle" ] || return 1
  codesign --verify --strict "$bundle" >/dev/null 2>&1 || return 1
  info=$(codesign -dvv "$bundle" 2>&1) || return 1
  case "$info" in *"TeamIdentifier=$AGNTUX_TEAM_ID"*) ;; *) return 1 ;; esac
  case "$info" in *"Identifier=$AGNTUX_BUNDLE_ID"*) ;; *) return 1 ;; esac
  return 0
}

# Constrain a bundled npm-cli.js to live INSIDE the codesign-verified bundle of
# $1 (the resolved Electron). The marker's npmCliPath is untrusted; only an
# npm-cli.js sealed under <bundle>/Contents/Resources/npm is trusted. Echoes the
# accepted path (deriving the default when $2 is empty/foreign), or nothing.
resolve_npm_cli() {
  # $1 = resolved electron, $2 = marker-provided npmCliPath (may be empty)
  el="$1"; cand="$2"
  bundle=${el%/Contents/MacOS/*}
  res_npm="$bundle/Contents/Resources/npm"
  case "$cand" in
    "$res_npm/"*) [ -f "$cand" ] && { printf '%s' "$cand"; return 0; } ;;
  esac
  [ -f "$res_npm/bin/npm-cli.js" ] && printf '%s' "$res_npm/bin/npm-cli.js"
  return 0
}

# ── node major-version floor (defends against a very old app marker) ──────────
# Fail-open: an unparseable/missing version never blocks resolution.
node_version_ok() {
  v="$1"
  [ -n "$v" ] || return 0
  major=$(printf '%s' "$v" | sed -n 's/^v\{0,1\}\([0-9][0-9]*\).*/\1/p')
  [ -n "$major" ] || return 0
  [ "$major" -ge 18 ] 2>/dev/null || return 1
  return 0
}

# ── 1. marker ─────────────────────────────────────────────────────────────────
if [ -r "$MARKER" ]; then
  cand=$(marker_str electronPath)
  nodever=$(marker_str nodeVersion)
  if node_version_ok "$nodever" && valid_runtime "$cand"; then
    ELECTRON="$cand"
    NPM_CLI=$(marker_str npmCliPath)
  fi
fi

# ── 2. fallback probe ─────────────────────────────────────────────────────────
# Search the standard install locations. AGNTUX_RUNTIME_PROBE_DIRS (colon-
# separated) overrides them for tests; it cannot weaken security — every
# candidate still has to pass valid_runtime's codesign identity gate.
if [ -z "$ELECTRON" ]; then
  probe_dirs="${AGNTUX_RUNTIME_PROBE_DIRS:-/Applications:$HOME/Applications}"
  OLD_IFS="$IFS"
  IFS=":"
  for base in $probe_dirs; do
    IFS="$OLD_IFS"
    for app in "$base"/*AgntUX*.app "$base"/*Agntux*.app; do
      [ -d "$app" ] || continue
      for exe in "$app"/Contents/MacOS/*; do
        if valid_runtime "$exe"; then
          ELECTRON="$exe"
          break 3
        fi
      done
    done
    IFS=":"
  done
  IFS="$OLD_IFS"
fi

# Constrain npm to the verified bundle (marker path may have carried a foreign
# or empty npmCliPath; the probe path carries none — derive it).
if [ -n "$ELECTRON" ]; then
  NPM_CLI=$(resolve_npm_cli "$ELECTRON" "$NPM_CLI")
fi

# ── exec ──────────────────────────────────────────────────────────────────────
if [ -n "$ELECTRON" ]; then
  AGNTUX_ELECTRON="$ELECTRON"
  AGNTUX_NPM_CLI="$NPM_CLI"
  export AGNTUX_ELECTRON AGNTUX_NPM_CLI
  export ELECTRON_RUN_AS_NODE=1
  exec "$ELECTRON" "$@"
fi

# ── 3. system node fallback (dev / power-user machines) ───────────────────────
if command -v node >/dev/null 2>&1; then
  # Leave AGNTUX_ELECTRON unset so the agntux-build server skips its npm shim
  # and uses the system node/npm already on PATH.
  exec node "$@"
fi

echo "agntux-node.sh: no AgntUX runtime found (marker, app bundle, or system node)." >&2
echo "  Open the AgntUX desktop app at least once, or install Node.js, then retry." >&2
exit 1

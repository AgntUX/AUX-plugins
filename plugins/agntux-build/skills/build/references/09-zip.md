# Stage 9 — package the plugin

The plugin builds. The action buttons render. Package it as a `.zip`
in the user's Downloads folder so they have a snapshot to look at and
so the final submission in stage 12 has something to attach.

**No install required.** Source plugins are remote-view-only — they
have no local MCP server, and Claude Cowork can't host a live local
plugin during iteration anyway. Stages 9.5 and 10 iterate on the
prompts inline; stage 12 re-zips with the contributor's signature
and hands the result off to AgntUX maintainers via `mailto:`.

## Generate the zip

Build location (cross-platform — pick the first that resolves):

| Platform       | Path                                                       |
|----------------|------------------------------------------------------------|
| Linux (XDG)    | `$(xdg-user-dir DOWNLOAD)/agntux-{slug}-v{version}.zip`    |
| macOS / Linux  | `$HOME/Downloads/agntux-{slug}-v{version}.zip`             |
| Windows        | `%USERPROFILE%\Downloads\agntux-{slug}-v{version}.zip`     |
| Fallback       | `$HOME/agntux-{slug}-v{version}.zip` (no Downloads dir)    |

Resolution algorithm:

1. On Linux, try `xdg-user-dir DOWNLOAD` (handles non-English locales
   and custom XDG settings). If it succeeds AND the resolved directory
   exists, use it.
2. Else try `$HOME/Downloads` (macOS / Linux default) or
   `%USERPROFILE%\Downloads` (Windows). If `existsSync` returns true,
   use it.
3. Else fall back to `$HOME` directly. Don't create `~/Downloads/` —
   the user's filesystem layout is theirs to set; just put the zip
   somewhere they can find it.

The version is part of the filename, so accumulating a paper trail in
Downloads is a feature — the user keeps every snapshot side-by-side.

Don't write to `<agntux-root>/.agntux-build/submissions/` (the previous
location). It's a dot-folder and most users can't easily browse there;
session state still lives at `<agntux-root>/.agntux-build/sessions/` but
the user-facing zip belongs in Downloads.

## Zip contents (mirror agntux-slack's shape)

```
agntux-{slug}/
├── .claude-plugin/plugin.json
├── LICENSE                           # Apache-2.0 (mirror of repo root)
├── README.md
├── CHANGELOG.md
├── package.json                      # plugin root manifest
├── vitest.config.ts
├── marketplace/
│   ├── listing.yaml
│   ├── icon.png
│   └── screenshots/
├── skills/
│   └── {plugin-slug}/                # rendered ingest skill tree
│       ├── SKILL.md
│       ├── _overrides/
│       └── reference/
├── view-tool/                        # the only runtime surface
│   ├── src/
│   ├── dist/                         # built bundles (handler + ui-resources + manifest)
│   ├── scripts/                      # emit-manifest.mjs
│   ├── __tests__/                    # payload-shape.test.ts + any other regressions
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.mjs           # when Tailwind is wired (canonical scaffold default)
└── __tests__/                        # plugin-level cold-start, render-reproducibility, etc.
```

**Explicit excludes** (the zip must NOT contain these paths even if
they exist on disk):

- `node_modules/`
- `mcp-server/` — remote-view-only plugins ship none. Invariant-checker
  rejects in stage 7 if present.
- `hooks/` — same.
- `.mcp.json` — same.
- `.omc/`, `.git/`, `.DS_Store`
- `NOTICE` — agntux-slack/gmail don't ship one; the Apache-2.0
  attribution lives in `LICENSE` alone.
- `host-renderer/`, `test-harness/`, `agents/` — those are
  agntux-build's own internals, never copied into a generated plugin.

`CONTRIBUTING-SIGNATURE.md` is NOT included in the stage-9 snapshot —
it's written in stage 12 with the submission timestamp and the final
zip is regenerated then.

Use `node:fs/promises` to enumerate the build tree and a zip
library (the host typically has `archiver` or similar — fall back to
`zip` shell if needed).

## Drop the zip into chat as an inline card (Cowork)

When the host supports it, also render the zip as a download card the
user can click in-chat — no Finder hunt, no path-copy-paste. The card
is supplementary: the absolute path below remains the primary
affordance because the user may need it to find the file on disk later.
Use the same ToolSearch + graceful-degradation idiom that
`agntux-core`'s onboarding skill uses for `request_cowork_directory`:

1. Resolve the tool:
   `ToolSearch({query: "select:mcp__cowork__present_files", max_results: 1})`.
2. On resolve, call
   `mcp__cowork__present_files({files: [{file_path: "{absolute-zip-path}"}]})`.
   The host renders the `.zip` as a download card right in the chat.
3. On no resolve (claude-desktop, MCPJam, any non-Cowork host), skip
   silently — the prose below carries the absolute path. **Never
   narrate the failed lookup.**

## What you say to the user

The prose below runs whether or not the card rendered — the absolute
path stays visible because the user may need it for the iteration
loop in stage 10:

> Your plugin is packaged at:
>
> **{absolute-zip-path}**
>
> Size: ~{N} MB.
>
> We'll iterate on the sync prompts in this same chat for the next few
> rounds, then re-zip at the end. The Downloads copy is your snapshot
> in case you want to look at it.

## Reveal the file in Finder/Explorer (optional)

If the user wants to see the file, and the host exposes a
"show in folder" tool, open Downloads:

```
mcp__filesystem__open_in_explorer (or similar)
```

Resolve via `ToolSearch`. If unavailable, just leave the path printed.

## Pass through to onboarding (stage 9.5)

Once the zip is on disk:

> Right — let's set up a realistic personalisation context, then
> we'll run sync against your real {connector-display-name} data.

Then load [`09a-onboarding-iterate.md`](09a-onboarding-iterate.md).

(Stage 9.5 synthesises a test persona + the source plugin's
`listing.yaml` metadata so stage 10 has realistic inputs. No
interview of the contributor, nothing written to disk. After 9.5,
stage 10 picks up.)

## Saved state at end of stage 9

```json
{
  ...,
  "zip_path": "/Users/.../Downloads/agntux-linear-v0.1.0.zip",
  "zip_size_bytes": 2400000,
  "zip_generated_at": "2026-05-08T..."
}
```

## What you do NOT do

- Don't walk an install flow here — there is none. Source plugins
  are loaded by the remote MCP server in `agntux/app`, and local
  install in Claude Cowork is broken for the view-tool path.
- Don't try to install the zip programmatically.
- Don't include `mcp-server/`, `hooks/`, `NOTICE`, or `.mcp.json` in
  the zip. The invariant-checker has already rejected the build if
  any of those are present on disk; the packager re-checks to be
  defensive.
- Don't fudge the path. Always show the absolute path.
- Don't write to `~/.agntux-build/` or any dot-folder for the
  user-facing zip. Downloads only.

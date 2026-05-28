# canonical/marketplace-assets

Placeholder assets that the stage-7 scaffold script copies into a newly
built plugin's `marketplace/` directory.

## icon.placeholder.png

- Dimensions: 512×512 pixels
- Format: PNG
- Size: ≤ 512 KB
- Content: dark background with "AUX" glyph — an AgntUX-style placeholder

This file is copied to `plugins/{slug}/marketplace/icon.png` during stage-7
scaffold by `scripts/scaffold-marketplace-assets.mjs` **only when no
`icon.png` is already present** (idempotent). Plugin authors must replace it
with real artwork before launch. Until then, the marketplace listing card
renders this glyph.

## screenshots/

Screenshots are **not required** for the marketplace (WS-C.2 / v2). The
scaffold script no longer creates `marketplace/screenshots/` or emits a
placeholder `00-overview.png`; the listing renders icon-only until a real
screenshot-capture pipeline lands (see the v2 plan "Out of scope"). If a
plugin author adds real screenshots, the linter validates their filenames,
dimensions, and size — but their absence is no longer a lint error.

## What belongs here vs. elsewhere

Assets specific to one plugin live in `plugins/{slug}/marketplace/`, not
here. This directory holds only canonical defaults that every new plugin
inherits at scaffold time.

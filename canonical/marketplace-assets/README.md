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

The scaffold script also ensures at least one file exists at
`plugins/{slug}/marketplace/screenshots/00-overview.png`. It copies
`icon.placeholder.png` as a stand-in when the stage-6 preview did not
emit a real screenshot. Plugin authors should replace it with a 1280×720
capture of the real UI.

## What belongs here vs. elsewhere

Assets specific to one plugin live in `plugins/{slug}/marketplace/`, not
here. This directory holds only canonical defaults that every new plugin
inherits at scaffold time.

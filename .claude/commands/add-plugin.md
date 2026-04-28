---
description: Walk through manually adding a plugin entry to the marketplace
argument-hint: <slug>
allowed-tools: Bash(ls *), Bash(cat *), Bash(git status), Bash(git diff *), Read, Write, Edit
---

You are helping a marketplace maintainer add a new plugin entry. This is rare — most plugins arrive via P6's generator PRs from `agntux/langgraph`. Use this only for the bootstrap, migrations, or recovery from a broken generator run.

The plugin slug is `$ARGUMENTS`. Confirm the slug with the user before doing anything that mutates the tree.

Steps:

1. Verify the slug doesn't already exist:
   - Check `plugins/$ARGUMENTS/` does not exist.
   - Check `.claude-plugin/marketplace.json` does not list the slug.
   - Check `marketplace/index.json` does not list the slug.

2. Scaffold the plugin directory per P15 §3 layout:
   - `plugins/$ARGUMENTS/plugin.json` (host-consumed plugin manifest)
   - `plugins/$ARGUMENTS/marketplace/listing.yaml` (P15 metadata)
   - `plugins/$ARGUMENTS/marketplace/icon.png` (placeholder; 512×512 ≤512 KB)
   - `plugins/$ARGUMENTS/marketplace/screenshots/` (≥1 PNG)
   - `plugins/$ARGUMENTS/README.md`
   - `plugins/$ARGUMENTS/CHANGELOG.md` (seed `## 0.1.0` entry)
   - `plugins/$ARGUMENTS/hooks/` (copy from `canonical/hooks/` byte-for-byte)
   - `plugins/$ARGUMENTS/LICENSE` (ELv2 stub — DO NOT replace)

3. Run `npm run lint:marketplace -- --plugin $ARGUMENTS` and surface any errors. Stop and ask the user before fixing anything that touches `plugins/$ARGUMENTS/`.

4. After the linter passes, run `npx tsx scripts/regenerate-marketplace-json.ts` and `npx tsx scripts/regenerate-aggregate-index.ts`. Show the regenerated diffs and confirm before staging.

5. Output a draft PR description matching `.github/PULL_REQUEST_TEMPLATE.md` and stop. Do NOT commit, push, or open a PR — leave that to the maintainer.

Always confirm before mutating files. Never edit `canonical/`. Never bypass the linter.

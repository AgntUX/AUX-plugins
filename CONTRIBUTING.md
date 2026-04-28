# Contributing to agntux/plugins

## External Contributions

External contributions are **not yet accepted**. AgntUX engineers contribute
via the langgraph generator (P6), which opens internal PRs from `gen/{slug}`
branches. External contributor onboarding is tracked in P14 and will be
enabled in a future milestone.

If you have a plugin proposal, open an issue using the
[Plugin Proposal template](https://github.com/agntux/plugins/issues/new?template=plugin_proposal.yml).

---

## For AgntUX Engineers

All authoring conventions are documented in `CLAUDE.md` at the repo root.
Open the repo in your host and the conventions are loaded into context
automatically.

Common operations have dedicated slash commands under `.claude/commands/`:

| Command | Purpose |
|---|---|
| `/lint-plugin {slug}` | Lint a plugin's marketplace metadata |
| `/bump-version {slug} {major\|minor\|patch}` | Apply the versioning rubric |
| `/rollback {slug}` | Step through the rollback runbook |
| `/review-pr [PR#]` | Apply the PR review checklist |
| `/update-canonical-hooks` | Walk through the canonical-hook update runbook |

---

## Branch Protection

The `main` branch is the canonical publish surface. The following branch
protection rules MUST be applied by a repo admin. They cannot be applied
without admin access to `github.com/agntux/plugins`.

**To apply via the GitHub CLI (requires admin token):**

```bash
# 1) One-time repo settings
gh repo edit agntux/plugins \
  --enable-issues \
  --enable-merge-commit \
  --enable-squash-merge \
  --enable-rebase-merge=false

# 2) Branch protection rule
gh api repos/agntux/plugins/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["lint","hook-hash-check","version-check"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  --field restrictions=null
```

**Rules to enforce:**
- Require pull request before merging (1 approving review, dismiss stale reviews)
- Require status checks to pass: `lint`, `hook-hash-check`, `version-check`
- Require branches to be up to date before merging
- Include administrators
- No direct pushes to `main`

---

## PR Review Checklist

Use `/review-pr` or apply manually:

- [ ] `marketplace/listing.yaml` passes `npm run lint:marketplace`
- [ ] `CHANGELOG.md` version matches `plugin.json` version
- [ ] Hook files are byte-identical to `canonical/hooks/` (CI `hook-hash-check` green)
- [ ] Screenshots are present, ≥1, dimensions correct (per P15 §4.2)
- [ ] `icon.png` is 512×512, ≤ 512 KB
- [ ] `README.md` is ≤ 500 lines and renders cleanly
- [ ] No custom fields added to `plugin.json` beyond the host spec
  (one permitted exception: `recommended_ingest_cadence`)
- [ ] ELv2 `LICENSE` stub present; not replaced or modified
- [ ] Version bump follows the semver rubric (MAJOR/MINOR/PATCH per CONTRIBUTING)

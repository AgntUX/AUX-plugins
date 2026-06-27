# Contributing to AgntUX/AUX-plugins

External contributions are **welcome**. Knowledge workers who use AgntUX
daily are best placed to tune prompts and schemas for the systems they
know — that's the contributor flywheel this project runs on.

If you have a plugin proposal, open an issue using the
[Plugin Proposal template](https://github.com/AgntUX/AUX-plugins/issues/new?template=plugin_proposal.yml).
For an end-to-end walkthrough of authoring a new plugin, install the
`plugin-toolkit` from the
[`agntux-plugin-dev` marketplace](https://github.com/AgntUX/agntux-plugin-dev).

---

## Developer Certificate of Origin (DCO)

This project uses the
[Developer Certificate of Origin](https://developercertificate.org/) — a
lightweight alternative to a CLA. By signing off your commits you certify
that you wrote the code or otherwise have the right to contribute it
under the project's Apache 2.0 license.

Sign off every commit with `git commit -s`. The trailer looks like:

```
Signed-off-by: Your Name <you@example.com>
```

Use your real name (no pseudonyms) and a working email address. The DCO
check enforces this on every PR; commits without sign-off will be
rejected.

---

## Marketplace Contributor Terms

Plugins submitted via the `agntux-build` flow are published to the **public
AgntUX marketplace** under the **Apache License 2.0**. By submitting you also
agree to the [Marketplace Contributor Terms](https://agntux.ai/terms) (§7 —
Plugin Marketplace), which cover publication, review, and takedown.

The `agntux-build` flow does **not** collect or publish your email, and a name
is **optional** — you're asked only whether you'd like to be credited, and can
stay anonymous. If you provide a name it appears in the `CONTRIBUTING-SIGNATURE.md`
contribution record shipped with the plugin; otherwise the record is anonymous.
On merge, maintainers sign off the public commit with the project's own identity,
so the DCO check passes without exposing your personal details. See the
[Privacy Policy](https://agntux.ai/privacy) for how AgntUX handles contributor
data. (Direct code contributors using `git commit -s` above still sign off with
their own name and email per standard DCO practice.)

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

---

## Branch Protection

The `main` branch is the canonical publish surface. The following branch
protection rules MUST be applied by a repo admin. They cannot be applied
without admin access to `github.com/AgntUX/AUX-plugins`.

**To apply via the GitHub CLI (requires admin token):**

```bash
# 1) One-time repo settings
gh repo edit AgntUX/AUX-plugins \
  --enable-issues \
  --enable-merge-commit \
  --enable-squash-merge \
  --enable-rebase-merge=false

# 2) Branch protection rule
gh api repos/AgntUX/AUX-plugins/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["lint","version-check","DCO"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  --field restrictions=null
```

**Rules to enforce:**
- Require pull request before merging (1 approving review, dismiss stale reviews)
- Require status checks to pass: `lint`, `version-check`, `DCO`
- Require branches to be up to date before merging
- Include administrators
- No direct pushes to `main`

The `DCO` check is provided by [Probot DCO](https://github.com/dcoapp/app),
installed at the GitHub org level (separate operational step).

---

## PR Review Checklist

Use `/review-pr` or apply manually:

- [ ] `marketplace/listing.yaml` passes `npm run lint:marketplace`
- [ ] `CHANGELOG.md` version matches `plugin.json` version
- [ ] No license gate or other paywall machinery introduced into any plugin (no `@agntux/mcp-license` import, no `<LicenseGate>` wrapper, no render-token verifier — plugins are Apache-2.0 and unconditionally free)
- [ ] Screenshots are present, ≥1, dimensions correct (per P15 §4.2)
- [ ] `icon.png` is 512×512, ≤ 512 KB
- [ ] `README.md` is ≤ 500 lines and renders cleanly
- [ ] No custom fields added to `plugin.json` beyond the host spec
  (one permitted exception: `recommended_ingest_cadence`)
- [ ] `LICENSE` is the Apache-2.0 standard text and unmodified
- [ ] Version bump follows the semver rubric (MAJOR/MINOR/PATCH per CLAUDE.md)
- [ ] All commits are signed-off (`git commit -s`)

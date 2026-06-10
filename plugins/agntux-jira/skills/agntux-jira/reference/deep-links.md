# Deep-link construction — Step 10 reference

Companion to `../SKILL.md` Step 10. The SKILL body describes WHEN
to emit an `Open in Jira (Atlassian Cloud)` row in `suggested_actions`;
this file describes HOW to construct the URL.

This file is **O** — per-plugin override. Sources without an obvious
"open in app" deep-link (or whose deep-link is trivially `https://
{source}.com/{id}`) ship no override and the canonical stub below
suffices. Sources with a richer deep-link family (Slack's
`/archives/{id}/p{ts_no_dot}`, Gmail's `?authuser=` form) ship a
wholesale `_overrides/resources/deep-links.md`.

## Generic shape

Most sources expose a deep-link of the form
`https://{tenant-or-app-host}/{path-template}/{id}`. Construct it
deterministically from the action's `source_ref` and any tenant-stable
identifier captured by Step 5 (workspace subdomain, account email,
etc.). If the tenant identifier is `null` for this run (cold-start —
not yet observed), set the URL to `null` and **omit** the `Open in
Jira (Atlassian Cloud)` row from `suggested_actions` rather than
emitting a placeholder URL the user can't click.

## URL families

Per-plugin overrides document the full URL family (thread vs. message,
public vs. DM, branch vs. archive) along with at least one worked
example.

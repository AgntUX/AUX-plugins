---
type: role-preset
role: swe
schema_version: "1.0.0"
---

# SWE role preset

Used by data-architect Mode A (bootstrap) when `user.md → # Identity → Role` matches `swe`, `software engineer`, `developer`, `engineer`, `staff engineer`, `senior engineer`, `dev`, `coder`.

## Suggested entity subtypes

- `person` — colleagues, code reviewers, on-call partners.
- `team` — squad, platform team, on-call rotation.
- `project` — repos or internal initiatives.
- `repo` — GitHub/GitLab repos (subtype distinct from `project` because PRs and incidents reference repos directly).
- `incident` — production incidents, postmortems.
- `topic` — RFCs, design discussions, technical themes.

Default if the user accepts: `person`, `team`, `project`, `repo`, `incident`, `topic`.

## Suggested action classes

Standard six PLUS:

- `pr-review` — a PR is awaiting review (or the user's review is awaiting them).
- `production-incident` — pages, alerts, outages.
- `on-call` — items specifically because the user is on-call.

## Notes

- SWE sources tilt toward GitHub/GitLab, Slack, PagerDuty/Datadog, Jira/Linear. Suggest GitHub-first.
- Goals tend to be project-scoped, not OKR-scoped. Probe for "what's the big thing you're shipping this quarter?" in the personalization interview.
- Glossary is light — codenames mostly, plus internal libraries/services. Don't oversize the glossary section.

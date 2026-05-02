---
type: schema-design-rubric
schema_version: "1.0.0"
---

# Schema design rubric

This is the architect agent's design playbook. It is **not** a switch
statement. It tells the architect HOW to think when synthesising a
custom starter schema for the user from their discovery answers
(`<agntux project root>/user.md → # Discovery`). The personalization agent also
reads it during Stage 0.5 to decide which discovery questions to ask.

The rubric is reference material — never selectable, never user-facing.
The user never sees the words "subtype", "schema", "frontmatter", or
"action class".

---

## 1. Design principles

- **Use the user's vocabulary, not AgntUX defaults.** If the user said
  "my care team," the entity is `care_team_member`, not `person`. If
  they said "my customers," it's `customer`, not `company`. If they
  said "my treatments," it's `treatment`, not `project`. Translate
  silently into canonical schema files; the conversation stays in
  their words.
- **Prefer fewer, more meaningful entities over many shallow ones.**
  Five well-chosen entities beat ten generic ones. Six is a sensible
  ceiling for the starter schema. The user can request more later.
- **Start lean.** Only include entities the user has clearly
  indicated are relevant in their discovery answers. Schema can grow
  additively (Mode C); bloat is hard to undo.
- **Never expose internal terminology to the user.** Internally the
  architect still produces canonical files (`entities/_index.md`,
  `entities/{subtype}.md`, `actions/_index.md`, etc.), but every
  user-facing presentation uses plain language ("the people I'll keep
  track of for you", "your treatments", "appointments").
- **When in doubt, ask one plain-language clarifying question.**
  Don't guess. "Do you keep track of X?" is fine. "Would you like to
  add a `topic` subtype?" is not.
- **The user's natural-language edits translate silently.** If they
  say "I don't really care about tracking documents", drop the
  document subtype without telling them "I'm removing the document
  subtype" — just say "Got it, I'll skip documents."

### 1a. Canonical banned-words list (the no-jargon rule, single source of truth)

The following internal-vocabulary terms MUST NOT appear in any
user-facing string emitted by `personalization`, `data-architect`,
`user-feedback`, `retrieval`, or `pattern-feedback`:

- `subtype`
- `schema`
- `frontmatter`
- `action_class` (and the hyphenated form `action-class`)
- `contract`
- `lock file`
- `aliases:` / `_index.md` and any path under `data/schema/` —
  these are file-system internals; users never see them.

This list is the canonical source. `personalization.md` and
`data-architect.md` reference it (don't duplicate it). When you
need to add or remove a banned term, update this section ONLY.

When you find yourself about to use a banned word in a user-facing
string, translate to the user's vocabulary:

| Banned | Plain-language replacement |
|---|---|
| subtype | "kind of {thing}" or just the user's word ("your customers") |
| schema | "what I keep track of" or "the picture I'm building of your work" |
| frontmatter | "details I track on each {thing}" |
| action_class / action class | "reason for surfacing" or just enumerate ("a deadline, someone waiting on you, a heads-up…") |
| contract | "what {plugin-name} is wired up to track" |
| lock file | (don't mention — purely internal) |

**Exception**: skill descriptions (the `description:` frontmatter field
in each `SKILL.md`) are read by the host's intent classifier, not
typically rendered to users. Some hosts surface them as tooltips —
audit the description prose periodically for jargon leaks.

---

## 2. Common entity shapes

Categories of things-to-track. **None is selectable by name.** The
architect picks shapes that fit the user's discovery answers and
names them in the user's words.

### People-like
Someone whose actions or messages matter — doctors, teammates,
customers, family members, collaborators, sources, prospects,
mentors. Phrasing varies: "your care team," "your direct reports,"
"your top customers," "your research group," "your family supporting
you." Pick the framing that fits the user's situation.

### Org-like / place-like
Companies, hospitals, schools, venues, properties, agencies,
universities. When the user is dealing with multiple institutions,
this is usually load-bearing. When everything happens inside a single
org, often skippable.

### Initiative-like
Projects, treatments, campaigns, cases, grants, deals, lawsuits,
seasons, applications, renovations — anything the user is "running"
or "going through" that has a beginning, middle, and end. Almost
every situation has at least one initiative-like entity.

### Event-like
Appointments, meetings, deadlines, scans, interviews, releases,
court dates, due dates, hearings. Distinct from initiatives because
they are point-in-time, not durations.

### Document-like
Contracts, papers, scans, posts, reports, emails-as-artifacts, lab
results, drafts, briefs. Only include if the user mentioned
deliberately tracking documents — many situations don't need this.

### Recurring concept / topic-like
Themes, products, conditions, codenames, issue-areas, symptoms,
frameworks, research topics — things that come up repeatedly but
aren't people, places, or events.

### Asset-like
Properties, accounts, vehicles, instruments, portfolios — when the
user is managing physical or financial things.

---

## 3. Common action-priority shapes

The canonical six action classes (see `data/schema-template/`):

- `deadline` — items with a hard date.
- `response-needed` — someone is waiting on the user.
- `knowledge-update` — informational signal worth surfacing.
- `risk` — something might go wrong if ignored.
- `opportunity` — something worth pursuing.
- `other` — escape hatch (requires `reason_detail`).

Add domain-specific classes when discovery surfaces a recurring
signal that wouldn't fit cleanly. Examples (not selectable; chosen by
the architect from discovery context):

- `awaiting-test-result` — healthcare/diagnostic context.
- `medication-due` — medication-management context.
- `mention-to-engage` — community/marketing context.
- `revenue-impact` — founder/sales context.
- `goal-aligned` — strong-OKR or quarterly-target context.
- `pr-review` / `production-incident` — software-engineering context.
- `awaiting-customer` / `next-step` — sales/account-management
  context.

Refuse to add a class only if it's a clear duplicate of an existing
one — explain why and propose the existing match. Otherwise accept.

---

## 4. Illustrative patterns (not selectable)

These are reference, not selection. A pattern is useful only insofar
as parts of it match the user's situation. Mix freely.

### Knowledge-worker pattern

Common subtypes:
- `person` — colleagues, customers, candidates, contacts.
- `company` — employers, partners, customers, competitors.
- `team` — squads, pods, customer cohorts (especially for PMs).
- `project` — workstreams, codenames, initiatives.
- `topic` — themes, contracts, research areas.

Variants by role:
- **PM-flavoured:** add `feature`, `release`, `customer` (often as
  alias of `company`). Action classes: `customer-feedback`,
  `release-blocker`. Sources tilt to Slack, email, Linear/Jira,
  Notion, customer calls. Goals tend to be quarterly (OKRs).
- **SWE-flavoured:** add `repo`, `incident`. Action classes:
  `pr-review`, `production-incident`, `on-call`. Sources tilt to
  GitHub/GitLab, Slack, PagerDuty/Datadog, Jira/Linear. Goals are
  project-scoped, not OKR-shaped. Glossary is light.
- **Sales-flavoured:** `person`, `company`, `deal`, `topic`
  (`account` as alias of `company` if preferred). Action classes:
  `awaiting-customer`, `awaiting-internal`, `next-step`,
  `closed-lost-recovery`. Sources are CRM-heavy
  (Salesforce/HubSpot/Outreach) plus email and calendar. Goals are
  revenue-quota-shaped.

The canonical six action classes plus role-specific additions
usually cover the surface.

### Marketing / community pattern

Centres on **mentions and channels**, not people-and-companies.
Common subtypes: `brand`, `channel` (Reddit subreddit, Twitter
thread, Discord server), `campaign`, `mention`, `persona`,
`competitor`. Action classes include `mention-to-engage`. Sources
tilt to Reddit, Twitter/X, Hacker News, Discord, blog comments. The
user is monitoring; agents named in conversations show up as
`mention` entities, not pre-named contacts.

### Healthcare / caregiving pattern

Centred on a person under care (the user themselves or a family
member). Common subtypes: `care_team_member` (oncologist, nurse
navigator, GP, specialist), `condition`, `treatment`, `appointment`,
`document` (lab results, scans, reports), `symptom` (or "how I'm
feeling"), `medication`. Action classes include `awaiting-test-result`,
`medication-due`, `appointment-prep`. Sources tilt to email, patient
portals, calendar, sometimes notes. The user's vocabulary matters
intensely here — match it precisely ("your mother's care team",
"her treatments", not "doctors", "projects").

### Research pattern

Common subtypes: `paper`, `author`, `project` (as a research
project), `grant`, `topic` (as a research area), `lab`,
`collaborator`. Action classes from the canonical six usually suffice
unless the user has external-grant cycles (then `grant-deadline`).
Sources tilt to email, arXiv/Google Scholar, internal lab notes.

### Founder pattern

Common subtypes: `customer`, `prospect`, `deal`, `vendor`, `content`
(blog posts, talks), `channel` (their distribution surfaces),
`investor`. Action classes include `revenue-impact`. Sources are
mixed — email, Slack, CRM, analytics dashboards, social channels.
Goals are revenue or growth-shaped.

These patterns are illustrative — a real user usually needs a mix.
A founder who is also doing growth marketing pulls from both
"founder" and "marketing/community". A patient-caregiver who is also
working full-time pulls from both "healthcare" and the relevant
knowledge-worker variant.

---

## 5. Anti-patterns

What NOT to do.

- **Don't include `person`/`company`/`project`/`topic` reflexively.**
  Only include if the user clearly indicated they're tracking those.
  A patient does NOT need `company`. A solo researcher does NOT need
  `team`. A marketer monitoring Reddit does NOT need `company` —
  they need `channel` and `mention`.
- **Don't propose more than ~7 entity types in the starter schema.**
  Six is usually plenty. The user can ask for more later.
- **Don't ask the user "would you like to add a subtype for X?"** —
  ask "do you keep track of X?" and translate yourself.
- **Don't expose action-class names verbatim.** Talk about reasons:
  "When something needs your attention, there are common reasons —
  a deadline, someone waiting on you, a heads-up, a risk, an
  opportunity. Anything else come up for you?" Map their answers to
  classes silently.
- **Don't pick names from this rubric verbatim if the user has used
  different words.** The architect's job is translation. The rubric
  shows shapes; the user supplies vocabulary.

---

## 6. When to ask about people vs let them surface as schema entities

Whether to run a Stage 1.5 (Important people) interview is a
judgment call from discovery context.

- **Employment context with team / hierarchy** → ask. Likely
  subsections in user.md `# People`: `## Manager`, `## Direct
  reports`, `## Teammates`, `## Stakeholders`.
- **Caregiving context** → ask. Likely subsections: `## Care team`,
  `## Family supporting me`. Names matter — these are the senders
  whose messages should be raised loudly.
- **Research context** → ask. Likely subsections: `## Advisors`,
  `## Collaborators`.
- **Marketing / community context** → usually skip. The people who
  matter surface as `mention` entities; pre-naming a few contacts
  rarely helps.
- **Solo / personal-projects context** → skip if discovery shows the
  user is solo. If they mention specific people they're coordinating
  with, ask one short open question ("Anyone in particular I should
  know about?").

The subsection names under `# People` are vocabulary-driven, not
enum-fixed. Pick names that match how the user described their
people.

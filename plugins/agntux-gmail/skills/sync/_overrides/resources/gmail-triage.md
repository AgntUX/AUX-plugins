# Gmail triage reference — Steps 6, 8, 8a

Companion to `../SKILL.md` Steps 6, 8, and 8a. Gmail-specific entity
resolution rules, signal layer, and follow-up scan definitions.

## Step 6 — Gmail entity guidance

For each fetched item, extract every distinguishable entity. Common
kinds you'll see in Gmail (only when your contract approves them):

- `person` — email correspondents. Identified by **email address**;
  email is the canonical cross-source alias used to merge with people
  surfaced by Slack and other sources. Extract `real_name` from the
  display-name portion of the `From:` header (e.g.
  `"John Jordan" <john@oatfinancial.com>` → `real_name: "John Jordan"`,
  `email: "john@oatfinancial.com"`).
- `company` — organisations resolved from sender email domains
  (`@oatfinancial.com` → `oatfi`) and signature blocks. Skip generic
  domains (`gmail.com`, `outlook.com`, `yahoo.com`, `hotmail.com`,
  `icloud.com`).
- `project` — codenames per `user.md → # Glossary`.
- `topic` — recurring themes surfaced across multiple Gmail threads.

**Threads themselves are NOT entities.** They surface via `source_ref`
on action items (`<thread_id>`) and via subject-line annotations in
`## Recent signals` bullets.

### Lookup-before-write — gmail specifics

Look up
`(subtype, source: "gmail", source_id: "<thread_id>")` in
`entities/_sources.json`. **For thread-rooted artefacts use the
thread's identifier — never a per-message id.** This prevents N
duplicate source-rows when one person is mentioned across N messages
in one thread.

For people without a thread match, **always Grep on the email
address** (the canonical cross-source alias). If a match is found via
email (e.g., the same person was already created by a Slack DM where
the slack profile email matched), open the existing entity and add
the gmail thread reference as a new `sources` entry. Do NOT create a
new file.

### Optional Gmail-deep-link frontmatter

When the subtype is `person` and the source artefact carries the
relevant identifiers, also include:

- `email` — the bare address. `email` is **required** when creating a
  person from Gmail — it's the cross-source alias and the validator
  will reject person creation without it.
- `gmail_label_ids` — the array of Gmail label IDs observed on
  messages from this person (e.g. `["IMPORTANT"]`). Set on creation;
  unioned across observations. Optional and additive.

For people, prefer slug `<first-name>-<last-name>` from the `From:`
display name; fall back to the local-part of the email address if the
display name is missing.

## Step 8 — Gmail signal layer

**Default Gmail action-worthy signals**:

- User is in `to:` (1:1 email or named recipient) from a real human →
  `response-needed`, priority `high`.
- User is in `cc:` from a real human → `response-needed`, priority
  `medium`.
- Thread where the user has previously replied AND someone has replied
  after the user's last message → `response-needed`, `medium`. The
  reply-state scan in Step 8a is the gate.
- Subject or body contains explicit deadline phrasing (`by EOD`,
  `before <day>`, ISO date inline, `due <date>`) → `deadline`. Priority
  `high` if within 48h, `medium` otherwise.
- **`IMPORTANT` Gmail label present** → priority bump (low → medium;
  medium → high). Not a sole trigger; it modulates an already-firing rule.
- User-sent thread with no reply for ≥3 days → `response-needed`,
  priority `low`, `reason_detail: "[awaiting-reply] sent {N} days ago, no response"`.
  Catches "you sent this and they haven't replied" follow-ups.
- Keywords in subject `outage|incident|sev[123]|breach|down|escalation`
  → `risk`, `high`.

**Default Gmail noise**:

- Sender matches `noreply@` / `no-reply@` / `notifications@` /
  `*-bounces@` / `mailer-daemon@` — skipped unless a `# Always raise`
  rule explicitly opts in (e.g., `from:digest@vercel.com` to allow a
  specific weekly digest).
- `category:promotions` / `category:social` / `category:forums` /
  `category:updates` — already filtered at the discovery query layer;
  if one slips through, skip.
- `category:updates` from `calendar-notification@google.com` (Google
  Calendar invitation/cancellation/update notifications) — skip;
  calendar is out of scope for this plugin.
- Threads with only the user as a participant (drafts that look like
  threads, BCC mailing list patterns where the user is the only visible
  member) — skip.

### Noise-drop counter (feeds Step 11 sub-step 5 auto-learn)

Whenever you skip a thread on a sender-derived rule (`noreply@` family,
`*-bounces@`, `mailer-daemon@`, or any sender that slipped through the
query-layer category exclusion), increment a working-memory counter
`noise_drop_counts[<sender-email>]` keyed by the bare sender address
(apply the same `<([^>]+)>` extraction as Step 5b). Step 11 sub-step 5
reads this counter to auto-learn new denylist entries — the procedure
lives in the sibling `denylist.md` resource (linked from `../SKILL.md`).

Do NOT track drops attributable to `# Never raise` rules or to
thread-level heuristics (only-user-participant, etc.) — those are not
sender-derived patterns and don't help denylist tuning.

There is no `decision-needed` action class for Gmail — fold into
`response-needed` per the contract.

## Step 8a — Gmail follow-up signals

Follow-up signal definitions for the reply-state scan:

- `?` — a literal question mark in any subsequent message body.
- An explicit ask — phrasing like "can you", "could you", "please",
  "would you mind", "let me know".
- A deadline phrase — `by <date>`, `by EOD`, `before <day>`, ISO date
  inline, `due <date>`.
- An escalation keyword — `urgent | asap | blocker | sev[123]`.

If any of these appear in a message authored after the user's last
reply, the user-already-replied skip does NOT fire — the action is
raised and the follow-up is cited in `## Why this matters` so the
priority is justified.

If the user replied with a message containing none of the above and
no subsequent follow-up appeared, skip raising and log a
`gmail-user-already-replied` debug entry to `sync.md → errors` (with
`source_ref: <thread_id>` and the user reply internalDate).

# Pending recipients body section — agntux-docusign

Wholesale additive reference for the `## Pending recipients` body section
written into DocuSign action files at Step 10 of the ingest skill.

This section is read at click time by `agntux_docusign_reminder_view`
(`view-tool/src/agntux-docusign-view.ts` `handleReminder`) via
`extractSection(body, "Pending recipients")`. Each line must follow the
pipe-delimited format documented below or it will be silently dropped by the
parser.

---

## Conditional body section: `## Pending recipients`

REQUIRED on every action item of kind `response-needed` where the user sent
the envelope and a signer is pending (the "stuck envelope" signal from
Step 5b triage signal 2). The section is written by the ingest agent at
Step 10 inside the action body, after the `## Why this matters` section.

### Format

Each pending signer is one line: `name | email | status`.

- `name` — the signer's display name (from `listRecipients → signers[].name`).
- `email` — the signer's email address (from `signers[].email`).
- `status` — the signer's current routing status from DocuSign. One of:
  `sent` (notified, not opened), `delivered` (opened, not signed),
  `waiting` (fallback when status is unknown).

Blank lines and lines that do not contain a pipe character are ignored by the
parser. Do not include a header row.

### Example

```markdown
## Pending recipients

Alice Doe | alice@example.com | sent
Bob Smith | bob@corp.example | delivered
```

### Derived from

`listRecipients(accountId, envelopeId, include_tabs: false)` →
`signers[]` filtered to those whose `status` is `sent` or `delivered`
(i.e. notified but not yet completed). Routing order is not needed here —
all pending signers are listed regardless of routing position.

### When to omit

- Action items for envelopes where the connected user is a signer themselves
  (signal 1: "Waiting on USER to sign") do not need this section — the
  reminder view is not offered for those; only a URL-open to DocuSign is
  surfaced.
- Agreement-type action items (kind `response-needed` or `knowledge-update`
  for `## Agreement expiring soon` and `## Auto-renewal imminent`) do not
  include this section.
- `knowledge-update` action items (completed or declined envelopes) do not
  include this section.

### View tool contract

`agntux_docusign_reminder_view` parses this section as:

```ts
recipientsSection
  .split("\n")
  .map(line => line.split("|").map(s => s.trim()))
  .filter(parts => parts.length >= 2 && !!parts[0])
  .map(([name, email, status]) => ({ name, email, status: status ?? "waiting" }))
```

Lines with fewer than two pipe-separated parts, or with an empty first part,
are silently dropped. The renderer shows a status badge coloured green for
`signed` / `completed` and amber for all other values.

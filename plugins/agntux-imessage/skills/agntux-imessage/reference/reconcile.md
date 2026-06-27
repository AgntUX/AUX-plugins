# Reconcile reference — Step 8.5 detection skeleton

Companion to `../SKILL.md` Step 8.5 ("Reconcile open action items against
fresh data"). The step body carries the candidate scan, the bounded
re-check, and the write rules; this file documents the **generic
classification skeleton** and how each source declares its own
resolution / staleness signals. Keep the per-source list short — it
splices into the rendered `sync.md` at the `<!-- append:step-reconcile -->`
marker and counts against that file's line budget.

## Why reconcile exists

An action item is a snapshot of "this needed you at ingest time T0." By
the next run the world has moved: the iMessage artefact may
be closed, cancelled, deleted, or simply edited. Without reconcile, a
handled item stays `open` and noisy, and a changed item shows a stale
`## Why this matters` and a stale pre-drafted payload. Reconcile is the
ingest pass owning the **whole lifecycle** of the actions it raised, not
just their birth.

## The three branches

For each open action the step resolves to a latest source state, then
picks exactly one branch:

1. **Resolved → `status: done`.** The artefact no longer needs the user.
   Generic signals, true for most sources:
   - The artefact reached a terminal state (closed / done / cancelled /
     declined / completed / merged / paid / signed).
   - The re-check returned a **positive** "deleted / not found" response, or
     the artefact is archived. (An errored re-check — auth / permission /
     network / rate-limit / ambiguous — is NOT a deletion signal; see the
     conservatism rule below.)
   - For `response-needed`: the user themselves replied / acted, with no
     qualifying follow-up after their reply (Step 8a's reply-state scan).
   Append a one-line `## Auto-resolved` note naming the signal, then close.

2. **Changed-but-valid → refresh in place, keep `open`.** The artefact
   still needs the user but its substance moved. Generic signals:
   - A new or shifted deadline / due date.
   - The body / description / subject was edited materially.
   - Participants, assignee, owner, amount, or priority-bearing fields
     changed.
   Rewrite `## Why this matters` to current reality, refresh `due_by` /
   `priority`, and re-run Step 10.1 so the pre-drafted payload reflects the
   new state. Never overwrite a `## User notes`-style hand-authored block.

3. **Unchanged → leave untouched.** No detectable movement. Step 9's dedup
   keeps this run from raising a duplicate.

## Conservatism rule

Auto-closing a still-live item is worse than leaving a handled item open
one extra run. When a signal is **ambiguous** (e.g. a status you can't map
cleanly to terminal-vs-active, or a re-check that errored), choose the
**unchanged** branch and move on — never guess `done`. The user can always
dismiss; they can't un-miss an auto-closed item they never saw.

## Declaring per-source signals (the append)

Each plugin replaces the abstractions above with concrete
iMessage specifics by shipping
`_overrides/step-reconcile-append.md`, spliced at the
`<!-- append:step-reconcile -->` marker in `sync.md`. Keep it to a tight
list — typically three short blocks:

- **Resolved when** — the source-native terminal signals. Examples by
  shape (author yours):
  - issue/ticket trackers: status in a terminal set (Done, Closed,
    Resolved, Won't Do); issue deleted.
  - calendar/scheduling: event cancelled, declined, or in the past with no
    pending RSVP.
  - messaging/mail: thread answered by the user with no follow-up; message
    deleted; conversation archived.
  - documents/files: file deleted; request fulfilled; signature complete.
  - finance/ops: charge refunded; dispute closed; invoice paid/void.
- **Changed-but-valid when** — the source-native fields whose movement
  should refresh the action (due date, assignee, amount, body edit, new
  participants), and which payload fields Step 10.1 must regenerate.
- **Re-check via** — the `mcp__Read_and_Send_iMessages__get_unread_imessages, mcp__Read_and_Send_iMessages__read_imessages, mcp__Read_and_Send_iMessages__search_contacts` read call(s) that fetch the
  single artefact by its `source_ref` for the bounded re-check (Step 8.5
  sub-step 2), and how to read "deleted / not found" from that call.

## Bounded cost

The targeted re-check is read-only and capped (25 artefacts/run, oldest-
open / highest-priority first). It must never advance the cursor or write
to iMessage. A re-check failure logs
`imessage-reconcile-failed` and skips that candidate; Step 11's
transactional rule leaves the cursor untouched on any failure.

# Gmail deep-links — Step 10 reference

Companion to `../SKILL.md` Step 10. The SKILL describes WHEN to emit an
`Open in Gmail` row in `suggested_actions`; this file describes HOW to
construct the URL.

## Construct the URL FIRST

Before assembling the `suggested_actions` block, walk this ladder and
stop at the first match:

1. **`account_index` is set** (parsed in Step 0 from
   `<agntux project root>/data/instructions/agntux-gmail.md → # Account
   / account_index`): assemble:

   ```
   gmail_thread_url := https://mail.google.com/mail/u/{account_index}/?idr=inbox/{thread_id}
   ```

   This is the only URL form that reliably routes a multi-account
   browser to the right Gmail slot. The `?idr=inbox/<thread_id>` query-
   string form (rather than the `#inbox/<thread_id>` fragment) is what
   Gmail itself emits from the account-switcher and is the user-tested-
   working shape; the `#`-fragment form sometimes falls through to
   `u/0` regardless of the path.

2. **Otherwise, if `user_email` is non-null** (Stage 2 of discovery
   captured it; sub-step 5a of `reference/fetch.md`): assemble:

   ```
   gmail_thread_url := https://mail.google.com/mail/?authuser={user_email}#inbox/{thread_id}
   ```

   The `authuser=` form works portably across multi-account Google
   sessions on most setups. It is the documented fallback when the user
   has not pinned an account index in instructions; on some browsers
   it may still route to `u/0`, which is the reason the
   `account_index` ladder above exists.

3. **Otherwise** (cold-start: `account_index` unset AND `user_email`
   still `null`): set `gmail_thread_url := null` and **omit** the
   `Open in Gmail` row from `suggested_actions` entirely (do not emit a
   placeholder URL the user can't click). Subsequent runs surface the
   row once `user_email` is observed or the user pins an
   `account_index`.

## Worked examples

`account_index: 2`, `source_ref: "19db06deec2c912f"` →

```
gmail_thread_url := "https://mail.google.com/mail/u/2/?idr=inbox/19db06deec2c912f"
```

`account_index: <unset>`, `user_email: "john@oatfinancial.com"`,
`source_ref: "1934f56abcdef012"` →

```
gmail_thread_url := "https://mail.google.com/mail/?authuser=john@oatfinancial.com#inbox/1934f56abcdef012"
```

`account_index: <unset>`, `user_email: null`, `source_ref: …` →
`gmail_thread_url := null`; omit the `Open in Gmail` row.

## Persisting `account_index` into `## Compose payload`

When emitting the `## Compose payload` body section in Step 10, copy
`account_index` (the integer or `null`) into the YAML alongside
`gmail_thread_url`. The compose iframe lifts it at click time so the
draft-creation link in the Save envelope (Step 2 of the two-step
Gmail-Connector envelope) lands on the same account slot.

## Cross-source-merged actions

When Step 9 merges this gmail signal into a sibling plugin's open action,
emit the `Open in Gmail` row alongside the sibling's existing
`Open in <other-source>` row — both are openLink rows pointing to
different surfaces; the host renders both buttons.

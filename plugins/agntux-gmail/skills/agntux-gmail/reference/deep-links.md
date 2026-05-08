# Gmail deep-links — Step 10 reference

Companion to `../SKILL.md` Step 10. The SKILL describes WHEN to emit an
`Open in Gmail` row in `suggested_actions`; this file describes HOW to
construct the URL.

## Construct the URL FIRST

Before assembling the `suggested_actions` block:

1. **If `user_email` is `null`** (cold-start: not yet derived this run),
   set `gmail_thread_url := null`. The `Open in Gmail` row will be
   omitted from the YAML below.
2. **Otherwise:** assemble:

   ```
   gmail_thread_url := https://mail.google.com/mail/?authuser={user_email}#inbox/{thread_id}
   ```

   The `authuser=` form works portably across multi-account Google
   sessions — the browser routes to whichever `u/<n>` slot has the
   target email logged in.

## Worked example

`user_email: "john@oatfinancial.com"`,
`source_ref: "1934f56abcdef012"` →

```
gmail_thread_url := "https://mail.google.com/mail/?authuser=john@oatfinancial.com#inbox/1934f56abcdef012"
```

## Fallback

When `user_email` is still `null` (cold-start, or the user hasn't sent
any mail and Stage 2 returned nothing), omit the `Open in Gmail` row
entirely from `suggested_actions` rather than emitting a placeholder URL
the user can't click. Subsequent runs include the row once `user_email`
is observed.

## Cross-source-merged actions

When Step 9 merges this gmail signal into a sibling plugin's open action,
emit the `Open in Gmail` row alongside the sibling's existing
`Open in <other-source>` row — both are openLink rows pointing to
different surfaces; the host renders both buttons.

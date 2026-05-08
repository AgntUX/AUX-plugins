# Slack deep-link construction

Companion to `../SKILL.md` Step 10. The SKILL body describes WHEN to
emit an `Open in Slack` row in `suggested_actions`; this file describes
HOW to construct the URL.

## slack_open_url construction

The same template covers every action shape this skill emits — the
channel-id prefix does not change the URL family:

| `source_ref` shape | Example channel id prefix | Notes |
|---|---|---|
| Thread-rooted action `<channel_id>#<thread_ts>` | `C` (public), `G` (private), `D` (DM), `C…`/`G…` (mpim group DM) | URL lands the user on the thread parent in Slack. |
| Top-level channel message `<channel_id>#<ts>` | same | URL lands on the message. |
| DM-rooted action `<D…>#<ts>` (1:1 DM) | `D` only | Same template; DM channel ids slot into the same `archives/{id}/p…` form. |

We do **not** branch on the channel-id prefix — Slack's
`https://{ws}.slack.com/archives/{any_channel_id}/p{ts_no_dot}` URL
family accepts every channel-id shape Slack issues (public `C`, legacy
private `G`, DM `D`, and the `C`/`G`/`D` shapes used for group DMs).
The reply-level `?thread_ts=…&cid=…` query form is intentionally out
of scope here — landing on the thread parent is the desired UX for
"Open in Slack".

## URL recipe

1. **If `workspace_subdomain` is `null`** (cold-start: no MCP permalink
   observed yet this run), set `slack_open_url := null`. The `Open in
   Slack` row will be omitted from the YAML — see Step 10's
   `suggested_actions` rules.
2. **Otherwise:** split `source_ref` on `#` to get `channel_id` and the
   trailing `ts_or_thread_ts` value. Build a path-segment by removing
   the dot and prepending `p` (e.g. `1777391863.734439` →
   `p1777391863734439`). Assemble:

   ```
   slack_open_url := https://{workspace_subdomain}.slack.com/archives/{channel_id}/{p_segment}
   ```

## Worked example

`workspace_subdomain: "oatfi"`, `source_ref: "C031V2MJ2KA#1777391863.734439"`
→ `slack_open_url := "https://oatfi.slack.com/archives/C031V2MJ2KA/p1777391863734439"`.

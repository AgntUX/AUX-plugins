# slack-thread canonical UI handler

Canonical reference implementation of the Slack thread reply UI handler for the
AgntUX plugin marketplace. Future Slack-related plugins copy this directory verbatim
and substitute the `{{placeholder}}` tokens listed below.

---

## What this ships

| File | Purpose |
|---|---|
| `handler/slack-thread.md` | UI-handler subagent skeleton — carries the P9 §5 operational manifest in YAML frontmatter. Runtime metadata only; no subagent is spawned from this file. |
| `mcp-server/src/ui-resources/slack-thread.ts` | Fragment merged into the plugin's `ui-resources.ts` `UI_PATHS` map at P6 substitution time. Returns `ui://slack-thread` bundle URL + `_meta.license`. |
| `mcp-server/src/tools/slack-thread-view.ts` | Stateless view tool (`slack_thread_view`). Accepts Slack thread data, returns `structuredContent` + `_meta.ui.resourceUri`. No Slack MCP imports. |
| `component/src/components/main-component.tsx` | React component — renders thread, exposes pre-filled reply textarea, assembles P9 §8.3 Send intent. |
| `component/src/lib/parse-payload.ts` | Defensive payload parser — no throws on any input. |
| `component/src/__tests__/main-component.test.tsx` | vitest + @testing-library/react — 5 scenario groups, 25+ test cases. |
| `component/{package.json,tsconfig.json,vitest.config.ts,vite.config.ts}` | Standalone vite + react package. Bundles via `vite-plugin-singlefile`. |

---

## Placeholders

P6 substitutes these `{{kebab-case}}` tokens at plugin-generation time.

| Placeholder | Where used | Example value |
|---|---|---|
| `{{plugin-slug}}` | `handler/slack-thread.md` frontmatter (`tools:` field), `ui-resources/slack-thread.ts` comments | `slack-ingest` |

Runtime `{single-curly}` tokens (NOT substituted by P6 — filled at host/orchestrator runtime):

| Token | Where | Meaning |
|---|---|---|
| `{ref}` | `operational.verb_phrases[]` | Slack `thread_ts` (e.g., `1714043640.001200`) |
| `{ids}` | `operational.verb_phrases[]` | Space-separated message IDs to highlight |
| `{text}` | `operational.verb_phrases[]` | Orchestrator-drafted reply text |
| `{propose_reply}` | Action item `host_prompt` slot | Filled by agntux-core click-time drafting (P9 D1) |
| `{action_id}` | Send intent body | Action item file slug from `<agntux project root>/actions/` |

---

## Wire-in instructions

### 1. P6 substitution

When the P6 generator produces a `slack-ingest` plugin, it:

1. Copies `handler/slack-thread.md` to `agents/ui-handlers/slack-thread.md` and
   replaces `{{plugin-slug}}` with `slack-ingest`.

2. Merges the `slackThreadUIPaths` entry from `mcp-server/src/ui-resources/slack-thread.ts`
   into the plugin's `mcp-server/src/ui-resources.ts` `UI_PATHS` constant:

   ```typescript
   // In plugin's mcp-server/src/ui-resources.ts
   const UI_PATHS: Record<string, string> = {
     "ui://slack-thread": "slack-thread/index.html",
     // ... other UI components
   };
   ```

3. Copies `mcp-server/src/tools/slack-thread-view.ts` to the plugin's
   `mcp-server/src/tools/slack-thread-view.ts` (no substitutions needed — the file
   is already concrete, not templated).

4. Registers the view tool in the plugin's `mcp-server/src/index.ts`:

   ```typescript
   import { viewToolDescriptor, handleSlackThreadView } from "./tools/slack-thread-view.js";

   const VIEW_TOOLS = {
     [viewToolDescriptor.name]: {
       description: viewToolDescriptor.description,
       inputSchema: viewToolDescriptor.inputSchema,
       handler: handleSlackThreadView,
     },
   };
   ```

5. Builds and bundles the component via `npm run build` in `component/`, then
   uploads the `dist/index.html` singlefile output to S3 at the path
   `slack-thread/index.html` under the plugin's signed base URL.

### 2. MCP server registration in .mcp.json

The plugin's `.mcp.json` registers two servers — the source Slack MCP and the
plugin's own local stdio MCP server:

```json
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-slack"],
      "env": { "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}" }
    },
    "slack-ingest-ui": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": {
        "PLUGIN_SLUG": "slack-ingest",
        "AGNTUX_DEV_MODE": "${AGNTUX_DEV_MODE:-0}"
      }
    }
  }
}
```

### 3. SKILL.md intent-key section

Add the following section to the plugin's `skills/orchestrator.md` so the host
knows how to fulfil `send-thread-reply` intents from the component (P9 §8.3):

```markdown
## intent-key:send-thread-reply

When you receive a `ui/message` whose first line matches:

  User confirmed sending this Slack reply to thread {thread_ts} in channel {channel_id}

Steps:
1. Extract `thread_ts`, `channel_id`, the reply text (between the `---` fences),
   and `action_id` from the intent body.
2. Call mcp__slack__post_message({ channel: <channel_id>, thread_ts: <thread_ts>,
                                   text: <reply text> }).
3. From the response, capture `{ ts, permalink }`.
4. If the post failed, surface a one-line message to the user:
   "Couldn't send Slack reply: <reason>. The action item is unchanged." STOP.
5. Edit <agntux project root>/actions/{action_id}.md:
   - Frontmatter: set `status: done` and `completed_at: <ISO now>`.
   - Body: append `## Resolution log` section if absent; append bullet:
     - <ISO now> — Sent reply via slack. permalink: <permalink>
6. Return no further tool calls and no assistant text.
```

---

## Build and test

```bash
cd component

# Install dependencies
npm install

# Run tests
npm test

# Type-check
npm run type-check

# Build singlefile bundle (output: dist/index.html)
npm run build
```

Expected test output: 25+ passing tests across 5 scenario groups.
Expected bundle: `dist/index.html`, target <200 KB gzipped.

---

## Design notes

Visual direction chosen by the `frontend-design` skill:

- **Aesthetic**: Editorial / archival — a purpose-built "paper trail" panel.
  Feels like a conversation record in a well-designed internal tool, not a generic AI chat UI.
- **Typography**: DM Serif Display (channel heading), IBM Plex Mono (message body — log/record feel),
  DM Sans (UI chrome: sender names, timestamps, buttons).
- **Palette**: Warm off-white background (`#F7F5F0`), cobalt blue accent (`#2B5CE6`),
  amber highlight for flagged messages (`#FFF0C2`).
- **Light mode only** — single color scheme, no dark mode (per project memory rule).
- Textarea auto-resizes. Send button disabled during streaming and after successful send
  (P9 §8.5 idempotency rule).

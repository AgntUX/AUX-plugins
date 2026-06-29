// =============================================================================
// {{view-tool-name}} — view tool for the {{ui-display-name}} MCP App.
//
// Runs on the remote MCP server in app/. Receives a ViewToolContext whose
// `fs` is S3-backed (in production) or local-fs-backed (in plugin-toolkit-test
// render-view-tool, the developer iteration loop). Returns a structuredContent
// object the iframe consumes via the postMessage protocol.
//
// Multi-tool shape: this file exports an ARRAY of viewTools. Single-view
// plugins (like this template) export a one-element array; multi-view plugins
// (e.g. agntux-slack with compose + canvas) export N elements. The compiled
// module's `default.viewTools` is the contract the remote registry consumes.
//
// ── Payload-shape rule ──────────────────────────────────────────────────────
//
// `structuredContent` is the JSON-RPC body the host returns to the chat
// model — capped at ~64 KB. Only ship fields the iframe actually binds to
// JSX. Build a row → grep your iframe for every field name on it → drop
// anything that's not bound. The bug class is silent: a saturated workspace
// (long thread, 30+ rows, max-length excerpts) inflates the wire body past
// the cap, the host rejects the result, the iframe never renders, and you
// only find out from a user report. See plugins/agntux-core/CHANGELOG.md →
// 9.5.3 for the canonical incident; this template ships a regression-guard
// test at `__tests__/payload-shape.test.ts` that enforces a byte budget +
// a frozen key set so the bug becomes structurally hard to ship.
//
// ── Response envelope rule ──────────────────────────────────────────────────
//
// Every handler return — success AND error branches — must ship a
// `content[]` block alongside `structuredContent`. Author the text via
// `renderConfirmationText(UI_LABEL)` from @agntux/plugin-runtime so the
// wording stays centralized across every plugin. Why this matters: the
// host materializes `structuredContent` into the iframe automatically, but
// the model only sees the wire result — a JSON blob it reasonably
// mistakes for "raw data I need to render somehow." Without `content[]`
// the model goes on to build a duplicate widget via the host's
// `visualize`/artifact tool and writes paragraphs of commentary
// summarizing the iframe the user can already see. The Claude Cowork
// post-render commentary / duplicate-widget regression was the canonical
// incident. The `content[].text` block explains the MCP Apps lifecycle
// — what the iframe is, where the data went, why the turn is complete —
// so the correct behavior follows naturally. See
// `packages/plugin-runtime/src/render-confirmation.ts` for the wording.
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  parseActionFile,
  renderConfirmationText,
} from "@agntux/plugin-runtime";
// Shared payload accessors — coerce every frontmatter read the same way.
// Use `str()` for free text, `idStr()` for identifier fields (a numeric id
// written unquoted in YAML parses as a number and `str()` would drop it,
// blanking the field and silently disabling its button), `strArr()` for
// string lists. Import from ./lib/payload.js; never re-author `str()` here.
import { str } from "./lib/payload.js";

// ── Constants & caps ─────────────────────────────────────────────────────────

const RESOURCE_URI = "ui://{{plugin-slug-kebab}}/{{ui-name}}" as const;

// ── Types ────────────────────────────────────────────────────────────────────

interface {{ui-name-pascal}}Args {
  action_id: string;
}

interface {{ui-name-pascal}}Payload {
  // Shape matches the structuredContent schema pinned in §2 of
  // ui-handler-author.md. Narrow it deliberately.
  action_id: string;
  title: string;
  body: string;
}

// ── Handler ──────────────────────────────────────────────────────────────────

// Human-readable label fed to renderConfirmationText() so the model's
// `content[].text` block names the surface the host just materialized
// (e.g. "AgntUX Slack reply composer"). Both success AND error branches
// ship the same block — the iframe renders both, so the
// "stop after rendering" framing applies either way. Wording is
// centralized in @agntux/plugin-runtime; tune once, every plugin gets
// the new wording on next build.
const UI_LABEL = "{{ui-display-name}}";

async function handle(
  args: {{ui-name-pascal}}Args,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: {{ui-name-pascal}}Payload;
}> {
  // ── Render-harness contract (load-bearing) ──────────────────────────────────
  // The headless render check — and any cold first paint in the real host —
  // invokes this view with EMPTY args `{}`, so `action_id` arrives `undefined`.
  // Guard it up front and render placeholders: never build `actions/undefined.md`
  // and never let a backing-data failure escape as an HTTP 500 to the iframe.
  // A view tool must ALWAYS render — missing/erroring data degrades to the empty
  // state, it does not crash the surface. This mirrors the agntux-gmail /
  // agntux-slack handlers (guard the id, then a catch-all that never rethrows).
  // Dropping either half is the 2026-06-01 calendar-build render-500 regression
  // (`tool-call HTTP 500: {"error":"not-found: actions/undefined.md"}`).
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL) }],
      structuredContent: { action_id: "", title: "", body: "" },
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const parsed = parseActionFile(buf.toString("utf8"));
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL) }],
      structuredContent: {
        action_id: actionId,
        // `str()` over an inline `as string ?? ""` cast: a cast lies to the
        // compiler (a numeric/array value sails through as the wrong type),
        // `str()` actually coerces. For an id field use `idStr()` instead.
        title: str(parsed.frontmatter.title),
        body: parsed.body ?? "",
      },
    };
  } catch {
    // Any failure — missing fixture, an fs error code other than not-found, a
    // parse error — degrades to the placeholder payload. Do NOT narrow on
    // `instanceof ViewToolFsError`: the error can cross the render-harness
    // boundary as a plain Error, so a narrow guard rethrows it → 500.
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL) }],
      structuredContent: { action_id: actionId, title: "", body: "" },
    };
  }
}

// ── OPT-IN: user-initiated (dual-trigger) mode ──────────────────────────────
//
// The default handler above is action_id-only — correct for views opened FROM
// an action item (triage, compose, canvas: the user clicks a suggested-action
// button and the host passes the action_id). If instead your view is
// USER-INITIATED — the user asks for it conversationally with no backing action
// file ("find a time to meet next week with Alice", "open the X composer for
// these three rows") — opt into the dual-trigger shape. See
// draft-flow-author.md §2b "user-initiated mode" for the full contract; the
// worked example is agntux-google-calendar's schedule view.
//
// 1) Widen the Args with the inline fields the skill lane will pass:
//
//      interface {{ui-name-pascal}}Args {
//        action_id?: string;            // now OPTIONAL
//        // … one optional field per structuredContent value the lane resolves
//        //    (e.g. draft_summary?, attendee_emails?, candidate_slots?) …
//      }
//
//      function hasInlineArgs(args: {{ui-name-pascal}}Args): boolean {
//        // presence (not truthiness) of ANY inline field → inline path
//        return args.draft_summary !== undefined /* || … */;
//      }
//
// 2) Resolve inline → disk → empty (NEVER read a fs path on the inline branch):
//
//      const actionId = typeof args.action_id === "string" ? args.action_id : "";
//      if (hasInlineArgs(args)) {
//        return { content: [{ type: "text", text: renderConfirmationText(UI_LABEL) }],
//                 structuredContent: buildFromInline(args) };   // coerce over defaults
//      }
//      if (!actionId) return /* empty placeholder payload */;
//      try { /* existing ctx.fs read of actions/${actionId}.md */ } catch { /* empty */ }
//
// 3) Loosen the inputSchema so the host knows it MAY pass the inline fields —
//    optional action_id + typed inline props, NOT required:["action_id"] /
//    additionalProperties:false:
//
//      inputSchema: {
//        type: "object",
//        properties: { action_id: { type: "string" }, /* …inline props… */ },
//        required: [],                 // not ["action_id"]
//        additionalProperties: true,   // not false
//      },
//
// 4) Write a TRIGGER-INTENT-FORWARD {{view-tool-description}} ("Use this
//    whenever the user wants to …") so the host selects the view for a
//    conversational request — an action_id-centric description ("Given an
//    action_id, …") will NOT be selected for an ad-hoc ask. Document both call
//    shapes (inline params for user-initiated; action_id for an action item).
//
// Skill side: the plugin's user-initiated lane (an additive
// _overrides/reference/{verb}.md, opted in via the canonical
// <!-- append:sub-commands -->/<!-- append:argument-parsing -->/
// <!-- append:ask-intent-redirect --> markers — see ingest STUBS.md) gathers
// the data (including any read-tool calls like suggest_time) and passes it
// inline. The iframe Send button stays the only write gate.
// ─────────────────────────────────────────────────────────────────────────────

// ── Descriptor ──────────────────────────────────────────────────────────────

const viewTool: ViewTool<{{ui-name-pascal}}Args, {{ui-name-pascal}}Payload> = {
  descriptor: {
    name: "{{view-tool-name}}",
    // Convention (agntux-build _template, P15 §UI tool descriptor suffix):
    // every UI-rendering tool description ends with the canonical
    // explanatory suffix below. Framing: don't tell the model what NOT
    // to do — explain the MCP Apps lifecycle so the correct behavior
    // follows naturally. The `content[].text` block emitted by the
    // handler (via renderConfirmationText()) reinforces the same frame
    // at response time. Author {{view-tool-description}} as the
    // verb-phrase / trigger-list body; the suffix is appended here so
    // authors don't have to remember (and can't accidentally double-up).
    description:
      "{{view-tool-description}} " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["action_id", "title", "body"],
      additionalProperties: false,
    },
    ui_resource_uri: RESOURCE_URI,
  },
  handle,
};

// ── Default export (the contract Phase 3's materialize.ts consumes) ─────────

const mod: ViewToolModule = { viewTools: [viewTool] };
export default mod;

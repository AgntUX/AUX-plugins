// =============================================================================
// agntux-core-view.ts — triage_view ViewTool for the agntux-core plugin's
// triage MCP App.
//
// Loaded server-side by the remote MCP registry; reads action files from
// ctx.fs (S3-backed in production, local-fs in the developer iteration
// loop). No node:fs imports — handler talks to ctx.fs only.
//
// Ordering note (P5 Decision 13): rows are ordered by frontmatter.updated_at
// (when present). statSync.mtimeMs-based ordering from the legacy
// mcp-server/src/tools/triage-view.ts is intentionally dropped — the remote
// fs shim does not surface mtimes.
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  parseActionFile,
  renderConfirmationText,
  type ActionFrontmatter,
  type SuggestedActionRow,
} from "@agntux/plugin-runtime";

// ── Constants & caps ─────────────────────────────────────────────────────────

const TRIAGE_RESOURCE_URI = "ui://agntux-core/triage" as const;
// Human-readable UI label fed to renderConfirmationText() so the model's
// `content[].text` block names the surface the host just materialized.
// Both success AND error branches ship the same block — the iframe
// renders both, so the "stop after rendering" framing applies either
// way. The wording itself is centralized in @agntux/plugin-runtime;
// tune it once, every plugin gets the new wording on next build.
const TRIAGE_UI_LABEL = "AgntUX triage UI";
const DEFAULT_LIMIT = 30;
const DEFAULT_HANDLED_DAYS = 7;
const MAX_HANDLED_RECENT = 10;
// Cap matches the rich UI's "max 6 inline, then '+N more'" inline display
// limit. Server-side cap means the UI never has to render the "+N more"
// affordance for entities beyond 6.
const MAX_RELATED_ENTITIES = 6;
// Cap on per-row suggested-action CTAs. Pre-trim 9.5.3 carried 6; the
// rich UI renders them as primary buttons and 4 is plenty (any real
// action with 5+ distinct CTAs is a design smell). Cap reduced to 4 to
// keep worst-case payload under the host's max-tokens cap.
const MAX_SUGGESTED_ACTIONS = 4;
const MAX_SUMMARY_CHARS = 200;
const MAX_TITLE_CHARS = 120;
// Per-excerpt cap. Pre-trim 9.5.3 carried 600 chars and a 30-row payload
// crossed the host's ~64 KB JSON-RPC max-tokens cap (~62 KB observed).
// The rich UI (restored in 9.6.0) renders these in an expandable Details
// panel, so 220 chars is enough to show 2–3 sentences of context. The
// combination (220-char excerpts × 2 + 4 suggested_actions + 6 related
// entities + the rest of the row) keeps worst-case 30-row payload under
// 55 KB, safely below the host cap (~15 % headroom). The regression
// guard at view-tool/__tests__/payload-shape.test.ts enforces the 55 KB
// budget.
const MAX_EXCERPT_CHARS = 220;

const PRIORITY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// ── Types ────────────────────────────────────────────────────────────────────
//
// Shape note: this payload is consumed exclusively by triage-ui.tsx (the
// MCP Apps iframe) via its rich React tree under view-tool/src/components/.
// 9.5.3 stripped the row to 7 fields when the iframe was a slim
// placeholder; 9.6.0 restored the rich UI which binds the fields listed
// in `normalizeAction` (main-component.tsx:321–383). 9.7.0 restores those
// fields to the wire payload so the Details panel, "via {source}" line,
// related-entity badges, suggested-action CTAs, and Created/Updated
// timestamps all render with real data.
//
// `MAX_EXCERPT_CHARS` is the single dial that bounds the payload's
// worst-case size — see the const comment above.

interface TriageActionRow {
  id: string;
  title: string;
  summary: string;
  priority: "high" | "medium" | "low";
  status: "open" | "snoozed";
  reason_class: string;
  due_by: string | null;
  // Rich UI fields. UI bindings (line refs in
  // view-tool/src/components/main-component.tsx after 9.6.0):
  //   snoozed_until  → "Snoozed until …" chip (when status === "snoozed")
  //   source         → "via {source}" subline + included in stop-raising prompt
  //   related_entities[] → inline EntityBadge list + Details panel
  //   suggested_actions[] → primary CTA buttons (Details + inline)
  //   why_matters_excerpt → "Why this matters" paragraph in Details panel
  //   personalization_fit_excerpt → "Personalization fit" paragraph in Details
  //   created_at     → "Created X ago" line + sort-by-recency key
  //   updated_at     → "· Updated X ago" suffix when >24h after created_at
  snoozed_until: string | null;
  source: string | null;
  related_entities: string[];
  suggested_actions: SuggestedActionRow[];
  why_matters_excerpt: string;
  personalization_fit_excerpt: string;
  created_at: string | null;
  updated_at: string | null;
}

interface TriageHandledRow {
  id: string;
  title: string;
  // Rich UI fields. UI bindings:
  //   priority   → carried for symmetry with open rows; reserved for future
  //                priority-sorted handled view (HandledAction interface
  //                already includes it).
  //   status     → drives Done/Dismissed pill colour + accordion counts.
  //                Pre-9.5.3 emitted both done and dismissed rows; the trim
  //                kept the count predicate (`done` or `dismissed`) in
  //                processActionsDir but lost the wire field — restoring it
  //                here makes the Dismissed badge render again.
  //   outcome    → inline outcome text on dismissed rows. Optional frontmatter
  //                field on dismissed actions (a short string describing why
  //                the action was set aside). Null on done rows and on
  //                dismissed rows whose authors didn't populate it.
  priority: "high" | "medium" | "low";
  status: "done" | "dismissed";
  handled_at: string;
  outcome: string | null;
}

interface TriageCounts {
  open: number;
  snoozed: number;
  handled_recent: number;
  truncated: boolean;
}

interface TriageStructuredContent {
  actions: TriageActionRow[];
  handled_recent: TriageHandledRow[];
  counts: TriageCounts;
  last_updated_at: string;
  bootstrap_mode: boolean;
}

interface TriageStructuredError {
  error: "actions_index_missing";
}

type TriagePayload = TriageStructuredContent | TriageStructuredError;

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + "…";
}

function asPriority(v: string): "high" | "medium" | "low" {
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}

function asActionStatus(v: string): "open" | "snoozed" {
  return v === "snoozed" ? "snoozed" : "open";
}

function asHandledStatus(v: string): "done" | "dismissed" {
  return v === "dismissed" ? "dismissed" : "done";
}

function deriveTitle(fm: ActionFrontmatter, why: string): string {
  if (fm.reason_detail) {
    const stripped = fm.reason_detail.replace(/^\[[^\]]+\]\s*/, "").trim();
    if (stripped) return truncate(stripped, MAX_TITLE_CHARS);
  }
  if (why) {
    const firstSentence = why.split(/[.!?]\s/, 1)[0] || why;
    return truncate(firstSentence.trim(), MAX_TITLE_CHARS);
  }
  return truncate(fm.id || "untitled", MAX_TITLE_CHARS);
}

function firstParagraph(s: string): string {
  if (!s) return "";
  const idx = s.indexOf("\n\n");
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

/**
 * Conflict-file pattern produced by the agntux-teams daemon when its
 * push detects a 409 from the server. The daemon renames the local
 * file to `{stem} ({DisplayName}'s conflicted copy YYYYMMDD-HHmm){ext}`
 * before re-pushing, so the original path keeps the server's content
 * and the local sibling preserves the user's divergent edits — see
 * `agntux-teams/src/daemon/push.ts → conflictedCopyPath()`.
 *
 * These sibling files keep the SAME `id:` in frontmatter as the
 * original action, so the triage view-tool would otherwise surface
 * each action N+1 times (once for the original, once per conflict
 * copy). 9.5.5 filters them out at `isActionFilePath()` so they
 * never enter the scan. The on-disk / S3 garbage-collection of
 * already-uploaded conflict files is a separate cleanup pass.
 *
 * Regex anchors on the literal "'s conflicted copy " phrase plus the
 * YYYYMMDD-HHmm timestamp inside parentheses so a user's natural-
 * language filename containing "conflict" can't match accidentally.
 */
const CONFLICTED_COPY_RE =
  /\(.+'s conflicted copy \d{8}-\d{4}\)\.[A-Za-z0-9]+$/;

/**
 * Filter a `list` / `listWithMeta` result down to real action files —
 * `.md` extension, no leading underscore (skips `_index.md` and any
 * other sidecar files that use the same convention), and not an
 * agntux-teams daemon conflict-copy sibling (those parse to the same
 * action id as the original and would produce N+1 phantom rows).
 */
export function isActionFilePath(p: string): boolean {
  const base = p.split("/").pop() ?? "";
  if (!base.endsWith(".md")) return false;
  if (base === "_index.md") return false;
  if (base.startsWith("_")) return false;
  if (CONFLICTED_COPY_RE.test(base)) return false;
  return true;
}

/**
 * Decide whether an action's frontmatter passes the triage-view's
 * status filter — i.e. whether the row is worth fetching the body
 * for. Implements the same predicate the post-parse loop used to
 * apply, but against the metadata-only index so we don't have to
 * read closed actions older than the handled cutoff at all.
 *
 *   - status=open    → always include
 *   - status=snoozed → always include (the view shows a snoozed count)
 *   - status=done    → include only if handled within the cutoff
 *   - status=dismissed → include only if handled within the cutoff
 *   - anything else  → exclude
 *
 * The `handled_at` heuristic mirrors `pickHandledAt` in the post-parse
 * path: prefer `completed_at` on done, `dismissed_at` on dismissed,
 * fall back to `updated_at`, then `created_at`. A handled action with
 * no usable timestamp is included so the renderer can still surface
 * it (rather than silently dropping it on bad data).
 */
export function shouldFetchForTriage(
  meta: Record<string, unknown> | null,
  handledCutoffMs: number,
): boolean {
  if (!meta) {
    // No metadata cache yet (cold first call) and the listWithMeta
    // fallback couldn't extract it either — include so the loader
    // surfaces malformed rows in the legacy "always read" mode.
    // Safer than silently dropping rows the view-tool would've
    // rendered before this optimization.
    return true;
  }
  const status =
    typeof meta.status === "string" ? meta.status.toLowerCase() : "";
  if (status === "open" || status === "snoozed") {
    return true;
  }
  if (status === "done" || status === "dismissed") {
    const completedAt =
      typeof meta.completed_at === "string" ? meta.completed_at : null;
    const dismissedAt =
      typeof meta.dismissed_at === "string" ? meta.dismissed_at : null;
    const updatedAt =
      typeof meta.updated_at === "string" ? meta.updated_at : null;
    const createdAt =
      typeof meta.created_at === "string" ? meta.created_at : null;
    const handledAt =
      (status === "done" ? completedAt : dismissedAt) ??
      updatedAt ??
      createdAt;
    if (!handledAt) {
      // Missing timestamp on a handled row — include so the renderer
      // shows it; ordering by mtime is impossible anyway in the
      // remote-fs world.
      return true;
    }
    const t = Date.parse(handledAt);
    if (Number.isNaN(t)) return true;
    return t >= handledCutoffMs;
  }
  // Unknown status — exclude. Better to drop a row the renderer
  // wouldn't have rendered anyway than to bloat the read path.
  return false;
}

async function processActionsDir(
  ctx: ViewToolContext,
  actionsPrefix: string,
  handledCutoffMs: number,
): Promise<{
  open: TriageActionRow[];
  handled: TriageHandledRow[];
  snoozedCount: number;
  // Max-of-row frontmatter.updated_at across the scanned set. Computed
  // server-side and surfaced as the top-level `last_updated_at` scalar
  // so the iframe can render the header "Updated X ago" stamp without
  // having to derive it from the row list (handled rows that get
  // dropped from `handled_recent` still contribute to freshness).
  // Per-row `updated_at` is ALSO shipped (9.7.0) for the "· Updated X
  // ago" suffix on the timestamp line — the two are deliberate, not
  // redundant.
  maxUpdatedAt: string;
}> {
  // listWithMeta returns every action's path AND its parsed YAML
  // frontmatter in a single call (one DB query if cached, parallel
  // S3 fetches if not). We push the status/handled-recent filter
  // into the metadata layer so closed actions older than the
  // handled cutoff are never read.
  //
  // This replaces the N+1 read pattern the previous implementation
  // had — for a workspace with 1000 actions of which 30 are open
  // and 5 are recently handled, this fetches 35 bodies instead of
  // 1000.
  let entries;
  try {
    entries = await ctx.fs.listWithMeta(actionsPrefix);
  } catch {
    return { open: [], handled: [], snoozedCount: 0, maxUpdatedAt: "" };
  }
  const filtered = entries.filter(
    (e) =>
      isActionFilePath(e.path) && shouldFetchForTriage(e.meta, handledCutoffMs),
  );
  const pathsToFetch = filtered.map((e) => e.path);
  // Single batched read — parallel S3 GETs with concurrency cap
  // applied inside the fs shim.
  const bodies = await ctx.fs.readMany(pathsToFetch);

  const open: TriageActionRow[] = [];
  const handled: TriageHandledRow[] = [];
  let snoozedCount = 0;
  let maxUpdatedAt = "";

  for (let i = 0; i < filtered.length; i++) {
    const buf = bodies[i];
    if (!buf) continue;
    let parsed;
    try {
      parsed = parseActionFile(buf.toString("utf8"));
    } catch {
      // Skip malformed files; never crash the whole render.
      continue;
    }
    const fm = parsed.frontmatter;
    if (!fm.id) continue;

    // Track the most-recent frontmatter.updated_at across the whole scan
    // (open + handled) for the top-level last_updated_at stamp. Done
    // before the status branch so closed actions still bump the
    // freshness mark.
    if (fm.updated_at && fm.updated_at > maxUpdatedAt) {
      maxUpdatedAt = fm.updated_at;
    }

    if (fm.status === "open" || fm.status === "snoozed") {
      if (fm.status === "snoozed") snoozedCount++;
      const why = parsed.why_matters;
      const fit = parsed.personalization_fit;
      const row: TriageActionRow = {
        id: fm.id,
        title: deriveTitle(fm, why),
        summary: truncate(firstParagraph(why), MAX_SUMMARY_CHARS),
        priority: asPriority(fm.priority),
        status: asActionStatus(fm.status),
        reason_class: fm.reason_class || "",
        due_by: fm.due_by || null,
        snoozed_until: fm.snoozed_until || null,
        source: fm.source || null,
        related_entities: fm.related_entities.slice(0, MAX_RELATED_ENTITIES),
        suggested_actions: fm.suggested_actions.slice(
          0,
          MAX_SUGGESTED_ACTIONS,
        ),
        why_matters_excerpt: truncate(why, MAX_EXCERPT_CHARS),
        personalization_fit_excerpt: truncate(fit, MAX_EXCERPT_CHARS),
        created_at: fm.created_at || null,
        updated_at: fm.updated_at || null,
      };
      open.push(row);
      continue;
    }
    if (fm.status === "done" || fm.status === "dismissed") {
      const handledAt =
        fm.status === "done"
          ? fm.done_at || fm.completed_at
          : fm.dismissed_at;
      if (!handledAt) continue;
      const t = new Date(handledAt).getTime();
      if (!Number.isFinite(t) || t < handledCutoffMs) continue;
      // `outcome` is not currently a typed frontmatter field on
      // ActionFrontmatter (parse-action.ts), but the rich UI renders it
      // when present on dismissed rows. Emit `null` so the wire shape is
      // stable and the UI's defensive `?? null` read works; promoting
      // outcome to a parsed frontmatter field is an additive follow-up.
      handled.push({
        id: fm.id,
        title: deriveTitle(fm, parsed.why_matters),
        priority: asPriority(fm.priority),
        status: asHandledStatus(fm.status),
        handled_at: handledAt,
        outcome: null,
      });
    }
  }

  return { open, handled, snoozedCount, maxUpdatedAt };
}

function sortOpen(open: TriageActionRow[]): void {
  open.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 99;
    const pb = PRIORITY_RANK[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return (a.due_by ?? "z").localeCompare(b.due_by ?? "z");
  });
}

function sortHandled(handled: TriageHandledRow[]): void {
  handled.sort((a, b) =>
    a.handled_at < b.handled_at ? 1 : a.handled_at > b.handled_at ? -1 : 0,
  );
}

// ── Handler ──────────────────────────────────────────────────────────────────

async function handleTriageView(
  _args: Record<string, unknown>,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: TriagePayload;
}> {
  const handledDays = DEFAULT_HANDLED_DAYS;
  const limit = DEFAULT_LIMIT;
  const handledCutoffMs = ctx.now().getTime() - handledDays * 86_400_000;

  const personalActionsPrefix = "actions";

  // Existence probe: in the legacy local-fs handler we did statSync on the
  // directory; ctx.fs has no directory-stat primitive, so we use `exists`
  // on the canonical `_index.md` (always present in an initialized store)
  // as a proxy. If the probe fails, fall through to the empty-actions
  // structured error so the iframe surfaces the onboarding pointer.
  const indexExists = await ctx.fs.exists(`${personalActionsPrefix}/_index.md`);
  if (!indexExists) {
    return {
      content: [
        { type: "text", text: renderConfirmationText(TRIAGE_UI_LABEL) },
      ],
      structuredContent: {
        error: "actions_index_missing",
      },
    };
  }

  const scan = await processActionsDir(
    ctx,
    personalActionsPrefix,
    handledCutoffMs,
  );
  sortOpen(scan.open);
  sortHandled(scan.handled);

  const truncated = scan.open.length > limit;
  const actionsCapped = truncated ? scan.open.slice(0, limit) : scan.open;
  const handledCapped = scan.handled.slice(0, MAX_HANDLED_RECENT);
  const openCount = scan.open.filter((a) => a.status === "open").length;

  // last_updated_at preserves the 9.5.2 data-mtime semantics — the
  // max-of-row frontmatter.updated_at across the scanned set — but is
  // now computed server-side in processActionsDir() and surfaced as a
  // single top-level scalar so per-row `updated_at` doesn't bloat the
  // wire payload. Falls back to ctx.now() when no row carries it.
  const lastUpdatedAt = scan.maxUpdatedAt || ctx.now().toISOString();

  const bootstrapMode =
    scan.open.length === 0 && scan.handled.length === 0;

  return {
    content: [
      { type: "text", text: renderConfirmationText(TRIAGE_UI_LABEL) },
    ],
    structuredContent: {
      actions: actionsCapped,
      handled_recent: handledCapped,
      counts: {
        open: openCount,
        snoozed: scan.snoozedCount,
        handled_recent: handledCapped.length,
        truncated,
      },
      last_updated_at: lastUpdatedAt,
      bootstrap_mode: bootstrapMode,
    },
  };
}

// ── Descriptor ───────────────────────────────────────────────────────────────

const triageView: ViewTool<Record<string, unknown>, TriagePayload> = {
  descriptor: {
    name: "agntux_core_triage_view",
    description:
      "Render the AgntUX triage UI populated with priority-sorted open action items and the most recently-handled items. Zero arguments — call with `{}`. Use when the user types `/agntux triage`, or asks any of: 'show triage' / 'what's hot' / 'what should I look at' / 'what's on my plate' / 'triage me' / 'show me my action items' / 'what should I do today' / 'what do I need to handle'. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        actions: { type: "array" },
        handled_recent: { type: "array" },
        counts: { type: "object" },
        last_updated_at: { type: "string" },
        bootstrap_mode: { type: "boolean" },
        error: { type: "string" },
      },
      additionalProperties: true,
    },
    ui_resource_uri: TRIAGE_RESOURCE_URI,
    // NOTE: `data_paths` lives in the manifest layer per ViewToolDescriptor's
    // contract (see context.ts). emit-manifest.mjs supplies the canonical
    // personal-actions default at build time, so it is NOT carried on the
    // runtime descriptor.
  },
  handle: handleTriageView,
};

// ── Mutation tools ──────────────────────────────────────────────────────────
//
// 10.0.0 — the iframe's write-back path (snooze / dismiss / set-status /
// save_triage_prefs / set_triage_pref) was moved from agntux-core's local
// stdio mcp-server into the view-tool bundle. The remote MCP server in
// agntux/app picks these up from the manifest's `mutation_tools[]`,
// registers them on `tools/list` (without `_meta.ui`), and routes
// callTool() invocations from inside the triage iframe to the handlers
// below. Writes go through `ctx.fs.update()` — CAS-guarded via
// `team_sync_push_entry` — and an SSE event fans out to the user's
// agntux-teams daemons so the new file lands on disk within ~1s.

import { dismissTool } from "./tools/dismiss.js";
import { setStatusTool } from "./tools/set-status.js";
import { snoozeTool } from "./tools/snooze.js";
import {
  savePrefsTool,
  setPrefTool,
} from "./tools/triage-prefs.js";

const mod: ViewToolModule = {
  viewTools: [triageView],
  mutationTools: [
    snoozeTool,
    dismissTool,
    setStatusTool,
    savePrefsTool,
    setPrefTool,
  ],
};

export default mod;

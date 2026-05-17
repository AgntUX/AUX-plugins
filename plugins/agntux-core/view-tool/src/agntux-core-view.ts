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
  type ActionFrontmatter,
} from "@agntux/plugin-runtime";

// ── Constants & caps ─────────────────────────────────────────────────────────

const TRIAGE_RESOURCE_URI = "ui://agntux-core/triage" as const;
const DEFAULT_LIMIT = 30;
const DEFAULT_HANDLED_DAYS = 7;
const MAX_HANDLED_RECENT = 10;
const MAX_SUMMARY_CHARS = 200;
const MAX_TITLE_CHARS = 120;

const PRIORITY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// ── Types ────────────────────────────────────────────────────────────────────
//
// Shape note: this payload is consumed exclusively by triage-ui.tsx (the
// MCP Apps iframe). Fields that the iframe doesn't render were stripped in
// 9.5.3 to keep the JSON-RPC tool-result body under the host's max-token
// cap — a 30-row payload with full excerpts hit ~62 KB and was being
// rejected on the way back to the chat model. `due_by` is kept because
// sortOpen() reads it; the iframe ignores it.

interface TriageActionRow {
  id: string;
  title: string;
  summary: string;
  priority: "high" | "medium" | "low";
  status: "open" | "snoozed";
  reason_class: string;
  // Internal use only — sort key for sortOpen. The iframe ignores this
  // field; kept on the row (vs. an intermediate sort tuple) because the
  // overhead is ~10 bytes per row and the simpler shape is easier to
  // reason about.
  due_by: string | null;
}

interface TriageHandledRow {
  id: string;
  title: string;
  handled_at: string;
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
  // server-side and surfaced as `last_updated_at` on the payload so the
  // iframe can render a meaningful "Updated X ago" stamp. Not shipped per
  // row — the 9.5.3 trim moved this to a single top-level scalar to keep
  // the wire payload under the host's max-tokens cap.
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
      const row: TriageActionRow = {
        id: fm.id,
        title: deriveTitle(fm, why),
        summary: truncate(firstParagraph(why), MAX_SUMMARY_CHARS),
        priority: asPriority(fm.priority),
        status: asActionStatus(fm.status),
        reason_class: fm.reason_class || "",
        due_by: fm.due_by || null,
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
      handled.push({
        id: fm.id,
        title: deriveTitle(fm, parsed.why_matters),
        handled_at: handledAt,
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
): Promise<{ structuredContent: TriagePayload }> {
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
      "Render the AgntUX triage UI populated with priority-sorted open action items and the most recently-handled items. Zero arguments — call with `{}`. Use when the user types `/agntux triage-digest`, or asks any of: 'show triage' / 'what's hot' / 'what should I look at' / 'what's on my plate' / 'triage me' / 'show me my action items' / 'what should I do today' / 'what do I need to handle'.",
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

const mod: ViewToolModule = {
  viewTools: [triageView],
};

export default mod;

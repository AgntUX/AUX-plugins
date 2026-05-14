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
  ViewToolFsError,
  parseActionFile,
  type ActionFrontmatter,
  type SuggestedActionRow,
} from "@agntux/plugin-runtime";

// ── Constants & caps ─────────────────────────────────────────────────────────

const TRIAGE_RESOURCE_URI = "ui://agntux-core/triage" as const;
const DEFAULT_LIMIT = 30;
const DEFAULT_HANDLED_DAYS = 7;
const MAX_HANDLED_RECENT = 10;
const MAX_RELATED_ENTITIES = 6;
const MAX_SUGGESTED_ACTIONS = 6;
const MAX_SUMMARY_CHARS = 200;
const MAX_TITLE_CHARS = 120;
const MAX_EXCERPT_CHARS = 600;

const PRIORITY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// ── Types ────────────────────────────────────────────────────────────────────

interface TriageActionRow {
  id: string;
  title: string;
  summary: string;
  priority: "high" | "medium" | "low";
  status: "open" | "snoozed";
  reason_class: string;
  due_by: string | null;
  snoozed_until: string | null;
  source: string | null;
  related_entities: string[];
  suggested_actions: SuggestedActionRow[];
  why_matters_excerpt: string;
  personalization_fit_excerpt: string;
  // Created/updated timestamps surfaced so the component can render
  // "Created X ago / Updated Y ago" lines and offer a sort-by-recency option.
  // Both read from frontmatter. `updated_at` may be absent on legacy files;
  // ordering falls back to `created_at`, then to filename order.
  created_at: string | null;
  updated_at: string | null;
}

interface TriageHandledRow {
  id: string;
  title: string;
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

// Resolve filenames under `actions/` to absolute relative paths the
// fs shim can read. Filters out _index.md and any underscore-prefixed
// names (we follow the same convention as the legacy handler).
async function listActionFiles(
  ctx: ViewToolContext,
  prefix: string,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await ctx.fs.list(prefix);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const path of entries) {
    const base = path.split("/").pop() ?? "";
    if (!base.endsWith(".md")) continue;
    if (base === "_index.md") continue;
    if (base.startsWith("_")) continue;
    out.push(path);
  }
  return out;
}

async function processActionsDir(
  ctx: ViewToolContext,
  actionsPrefix: string,
  handledCutoffMs: number,
): Promise<{
  open: TriageActionRow[];
  handled: TriageHandledRow[];
  snoozedCount: number;
}> {
  const files = await listActionFiles(ctx, actionsPrefix);
  const open: TriageActionRow[] = [];
  const handled: TriageHandledRow[] = [];
  let snoozedCount = 0;

  for (const filePath of files) {
    let parsed;
    try {
      const buf = await ctx.fs.readFile(filePath);
      parsed = parseActionFile(buf.toString("utf8"));
    } catch {
      // Skip malformed / missing files; never crash the whole render.
      continue;
    }
    const fm = parsed.frontmatter;
    if (!fm.id) continue;

    if (fm.status === "open" || fm.status === "snoozed") {
      if (fm.status === "snoozed") snoozedCount++;
      const why = parsed.why_matters;
      const fitRaw = parsed.personalization_fit;
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
        personalization_fit_excerpt: truncate(fitRaw, MAX_EXCERPT_CHARS),
        created_at: fm.created_at || null,
        // P5 Decision 13: order by frontmatter.updated_at. Falls back to
        // null when the frontmatter doesn't carry it.
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

  return { open, handled, snoozedCount };
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

  // last_updated_at picks the most-recent action `updated_at` across the
  // scanned rows. Falls back to ctx.now() when no row carries it.
  let lastUpdatedAt = "";
  for (const row of scan.open) {
    if (row.updated_at && row.updated_at > lastUpdatedAt) {
      lastUpdatedAt = row.updated_at;
    }
  }
  if (!lastUpdatedAt) {
    lastUpdatedAt = ctx.now().toISOString();
  }

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
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleTriageView,
};

const mod: ViewToolModule = {
  viewTools: [triageView],
};

export default mod;

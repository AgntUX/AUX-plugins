// =============================================================================
// triage_view — render tool for the AgntUX action-item triage MCP App.
//
// Shape rules:
//   - inputSchema has ZERO fields. Server-side caps (DEFAULT_HANDLED_DAYS,
//     DEFAULT_LIMIT) are constants that the LLM never needs to fill in or
//     override. This keeps the tool-call latency low and the argument-token
//     cost effectively zero.
//   - The handler reads from the local AgntUX project root server-side. This
//     is a justified deviation from the canonical "view tools must be
//     stateless / no fs reads" rule because the source data IS local files;
//     there is no third-party MCP for the LLM to call first.
//   - The handler is read-only: zero file writes, zero network. Stateless
//     across calls — same project state in, same payload out.
//   - structuredContent budgets are enforced server-side (max 30 actions,
//     last 7 days handled max 10, body excerpts ≤600 chars). The handler
//     never returns more than these caps, even when the LLM passes larger
//     values.
//
// Returns:
//   On success — { structuredContent: TriagePayload, content: [...], _meta }
//   On graceful error — { structuredContent: { error: 'actions_index_missing' }, ... }
//
// Errors are STRUCTURED (per P2a §4): the tool never throws an exception
// from the happy path, so the host always renders the iframe and the
// component shows the corresponding degraded-state copy.
// =============================================================================

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expectedAgntuxRoot } from "../agntux-root.js";
import {
  parseActionFile,
  type ActionFrontmatter,
  type SuggestedActionRow,
} from "../parse-action.js";

// ── Constants & caps ─────────────────────────────────────────────────────────

const TRIAGE_RESOURCE_URI = "ui://triage";
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
  // `created_at` is read from frontmatter; `updated_at` is the file mtime
  // (frontmatter doesn't carry an `updated_at` for actions, so file mtime
  // is the most accurate signal of recency — captures status flips, body
  // appends, suggested-action edits all without coupling to a writer that
  // remembers to bump a field).
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

interface ViewToolMeta {
  ui: {
    resourceUri: typeof TRIAGE_RESOURCE_URI;
  };
  "ui/resourceUri": typeof TRIAGE_RESOURCE_URI;
}

interface ViewToolSuccess {
  structuredContent: TriageStructuredContent;
  content: Array<{ type: "text"; text: string }>;
  _meta: ViewToolMeta;
}

interface ViewToolError {
  structuredContent: TriageStructuredError;
  content: Array<{ type: "text"; text: string }>;
  _meta: ViewToolMeta;
}

type ViewToolResult = ViewToolSuccess | ViewToolError;

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // Reserve one char for the ellipsis so the returned string never exceeds `max`.
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
  // Prefer the parenthetical-stripped reason_detail; fall back to first
  // sentence of why_matters; fall back to the action ID.
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

function listActionFiles(actionsDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(actionsDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    if (name === "_index.md") continue;
    if (name.startsWith("_")) continue;
    out.push(join(actionsDir, name));
  }
  return out;
}

function indexLastUpdated(actionsDir: string): string {
  // Read frontmatter `updated_at` from _index.md if present; otherwise return
  // the most-recent action file's mtime as ISO. Falls back to "" if neither is
  // available. Never throws.
  try {
    const indexPath = join(actionsDir, "_index.md");
    const stat = statSync(indexPath);
    return new Date(stat.mtimeMs).toISOString();
  } catch {
    return "";
  }
}

// ── Tool descriptor ──────────────────────────────────────────────────────────

export const triageViewTool = {
  name: "agntux_core_triage_view",
  description:
    "Render the AgntUX triage UI populated with priority-sorted open " +
    "action items and the most recently-handled items. Reads the local " +
    "AgntUX knowledge store server-side. Zero arguments — call with `{}`. " +
    "Use when the user types `/agntux triage-digest`, or asks any of: 'show " +
    "triage' / 'what's hot' / 'what should I look at' / 'what's on my " +
    "plate' / 'triage me' / 'show me my action items' / 'what should I " +
    "do today' / 'what do I need to handle'. Returns _meta.ui.resourceUri " +
    "= ui://triage.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
  // outputSchema is what tells the host "this tool returns structuredContent
  // that should be passed to the iframe as toolOutput, not surfaced to the
  // model as chat text." Without it, Claude Cowork (and per the upstream
  // app project's c023186 fix, ChatGPT) silently text-render the
  // structuredContent — the iframe never opens. Mirrors the official
  // ext-apps `scenario-modeler-server` example, which declares both
  // `_meta.ui.resourceUri` and `outputSchema` for the same combination of
  // structuredContent + iframe. No `required` fields: both the success
  // payload and the structured-error envelope (`{error: ...}`) need to
  // validate.
  outputSchema: {
    type: "object" as const,
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            priority: { type: "string" },
            status: { type: "string" },
            reason_class: { type: "string" },
            due_by: {},
            snoozed_until: {},
            source: {},
            related_entities: { type: "array", items: { type: "string" } },
            suggested_actions: { type: "array" },
            why_matters_excerpt: { type: "string" },
            personalization_fit_excerpt: { type: "string" },
            created_at: {},
            updated_at: {},
          },
        },
      },
      handled_recent: { type: "array" },
      counts: {
        type: "object",
        properties: {
          open: { type: "number" },
          snoozed: { type: "number" },
          handled_recent: { type: "number" },
          truncated: { type: "boolean" },
        },
      },
      last_updated_at: { type: "string" },
      bootstrap_mode: { type: "boolean" },
      error: { type: "string" },
    },
  },
  // The MCP Apps spec defines two synonymous keys for declaring a tool's
  // associated UI resource: the modern nested `_meta.ui.resourceUri` and the
  // legacy flat `_meta["ui/resourceUri"]`. The official `registerAppTool`
  // helper in @modelcontextprotocol/ext-apps emits both, so we do too —
  // defensive against any host that only reads one of them.
  _meta: {
    ui: {
      resourceUri: TRIAGE_RESOURCE_URI,
    },
    "ui/resourceUri": TRIAGE_RESOURCE_URI,
  },
} as const;

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleTriageView(
  _args: Record<string, unknown>,
): Promise<ViewToolResult> {
  const handledDays = DEFAULT_HANDLED_DAYS;
  const limit = DEFAULT_LIMIT;

  const root = expectedAgntuxRoot();
  const actionsDir = join(root, "actions");

  let dirStat: ReturnType<typeof statSync>;
  try {
    dirStat = statSync(actionsDir);
  } catch {
    return structuredError(
      "actions_index_missing",
      `triage_view: ${actionsDir} does not exist.`,
    );
  }
  if (!dirStat.isDirectory()) {
    return structuredError(
      "actions_index_missing",
      `triage_view: ${actionsDir} is not a directory.`,
    );
  }

  const files = listActionFiles(actionsDir);

  const open: TriageActionRow[] = [];
  const handled: TriageHandledRow[] = [];
  const handledCutoffMs = Date.now() - handledDays * 86_400_000;
  let snoozedCount = 0;

  for (const filePath of files) {
    let parsed;
    let fileMtime: string | null = null;
    try {
      parsed = parseActionFile(filePath);
      try {
        fileMtime = new Date(statSync(filePath).mtimeMs).toISOString();
      } catch {
        fileMtime = null;
      }
    } catch {
      // Skip malformed files; never crash the whole render.
      continue;
    }
    const fm = parsed.frontmatter;
    if (!fm.id) continue;

    if (fm.status === "open" || fm.status === "snoozed") {
      if (fm.status === "snoozed") snoozedCount++;
      const why = parsed.why_matters;
      const fitRaw = parsed.personalization_fit;
      open.push({
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
        updated_at: fileMtime,
      });
      continue;
    }
    if (fm.status === "done" || fm.status === "dismissed") {
      const handledAt =
        fm.status === "done" ? fm.completed_at : fm.dismissed_at;
      if (!handledAt) continue;
      const t = new Date(handledAt).getTime();
      if (!Number.isFinite(t) || t < handledCutoffMs) continue;
      handled.push({
        id: fm.id,
        title: deriveTitle(fm, parsed.why_matters),
        priority: asPriority(fm.priority),
        status: asHandledStatus(fm.status),
        handled_at: handledAt,
        outcome: null, // outcome history lives in body; v1 omits.
      });
    }
  }

  // Sort: open first by priority then due date asc; handled by handled_at desc.
  open.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 99;
    const pb = PRIORITY_RANK[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return (a.due_by ?? "z").localeCompare(b.due_by ?? "z");
  });
  handled.sort((a, b) =>
    a.handled_at < b.handled_at ? 1 : a.handled_at > b.handled_at ? -1 : 0,
  );

  const truncated = open.length > limit;
  const openCapped = truncated ? open.slice(0, limit) : open;
  const handledCapped = handled.slice(0, MAX_HANDLED_RECENT);

  const lastUpdatedAt = indexLastUpdated(actionsDir) || new Date().toISOString();
  const bootstrapMode = open.length === 0 && handled.length === 0;

  const payload: TriageStructuredContent = {
    actions: openCapped,
    handled_recent: handledCapped,
    counts: {
      open: open.filter((a) => a.status === "open").length,
      snoozed: snoozedCount,
      handled_recent: handledCapped.length,
      truncated,
    },
    last_updated_at: lastUpdatedAt,
    bootstrap_mode: bootstrapMode,
  };

  return {
    structuredContent: payload,
    content: [
      {
        type: "text",
        text: bootstrapMode
          ? "Triage rendered. No items yet — bootstrap mode."
          : `Triage rendered. ${openCapped.length} open, ${handledCapped.length} recently handled.`,
      },
    ],
    _meta: {
      ui: {
        resourceUri: TRIAGE_RESOURCE_URI,
      },
      "ui/resourceUri": TRIAGE_RESOURCE_URI,
    },
  };
}

function structuredError(
  kind: "actions_index_missing",
  message: string,
): ViewToolError {
  return {
    structuredContent: { error: kind },
    content: [{ type: "text", text: message }],
    _meta: {
      ui: {
        resourceUri: TRIAGE_RESOURCE_URI,
      },
      "ui/resourceUri": TRIAGE_RESOURCE_URI,
    },
  };
}

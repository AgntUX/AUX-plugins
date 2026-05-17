// src/agntux-core-view.ts
import {
  parseActionFile
} from "@agntux/plugin-runtime";
var TRIAGE_RESOURCE_URI = "ui://agntux-core/triage";
var DEFAULT_LIMIT = 30;
var DEFAULT_HANDLED_DAYS = 7;
var MAX_HANDLED_RECENT = 10;
var MAX_SUMMARY_CHARS = 200;
var MAX_TITLE_CHARS = 120;
var PRIORITY_RANK = {
  high: 0,
  medium: 1,
  low: 2
};
function truncate(s, max) {
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + "\u2026";
}
function asPriority(v) {
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}
function asActionStatus(v) {
  return v === "snoozed" ? "snoozed" : "open";
}
function deriveTitle(fm, why) {
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
function firstParagraph(s) {
  if (!s) return "";
  const idx = s.indexOf("\n\n");
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}
var CONFLICTED_COPY_RE = /\(.+'s conflicted copy \d{8}-\d{4}\)\.[A-Za-z0-9]+$/;
function isActionFilePath(p) {
  const base = p.split("/").pop() ?? "";
  if (!base.endsWith(".md")) return false;
  if (base === "_index.md") return false;
  if (base.startsWith("_")) return false;
  if (CONFLICTED_COPY_RE.test(base)) return false;
  return true;
}
function shouldFetchForTriage(meta, handledCutoffMs) {
  if (!meta) {
    return true;
  }
  const status = typeof meta.status === "string" ? meta.status.toLowerCase() : "";
  if (status === "open" || status === "snoozed") {
    return true;
  }
  if (status === "done" || status === "dismissed") {
    const completedAt = typeof meta.completed_at === "string" ? meta.completed_at : null;
    const dismissedAt = typeof meta.dismissed_at === "string" ? meta.dismissed_at : null;
    const updatedAt = typeof meta.updated_at === "string" ? meta.updated_at : null;
    const createdAt = typeof meta.created_at === "string" ? meta.created_at : null;
    const handledAt = (status === "done" ? completedAt : dismissedAt) ?? updatedAt ?? createdAt;
    if (!handledAt) {
      return true;
    }
    const t = Date.parse(handledAt);
    if (Number.isNaN(t)) return true;
    return t >= handledCutoffMs;
  }
  return false;
}
async function processActionsDir(ctx, actionsPrefix, handledCutoffMs) {
  let entries;
  try {
    entries = await ctx.fs.listWithMeta(actionsPrefix);
  } catch {
    return { open: [], handled: [], snoozedCount: 0, maxUpdatedAt: "" };
  }
  const filtered = entries.filter(
    (e) => isActionFilePath(e.path) && shouldFetchForTriage(e.meta, handledCutoffMs)
  );
  const pathsToFetch = filtered.map((e) => e.path);
  const bodies = await ctx.fs.readMany(pathsToFetch);
  const open = [];
  const handled = [];
  let snoozedCount = 0;
  let maxUpdatedAt = "";
  for (let i = 0; i < filtered.length; i++) {
    const buf = bodies[i];
    if (!buf) continue;
    let parsed;
    try {
      parsed = parseActionFile(buf.toString("utf8"));
    } catch {
      continue;
    }
    const fm = parsed.frontmatter;
    if (!fm.id) continue;
    if (fm.updated_at && fm.updated_at > maxUpdatedAt) {
      maxUpdatedAt = fm.updated_at;
    }
    if (fm.status === "open" || fm.status === "snoozed") {
      if (fm.status === "snoozed") snoozedCount++;
      const why = parsed.why_matters;
      const row = {
        id: fm.id,
        title: deriveTitle(fm, why),
        summary: truncate(firstParagraph(why), MAX_SUMMARY_CHARS),
        priority: asPriority(fm.priority),
        status: asActionStatus(fm.status),
        reason_class: fm.reason_class || "",
        due_by: fm.due_by || null
      };
      open.push(row);
      continue;
    }
    if (fm.status === "done" || fm.status === "dismissed") {
      const handledAt = fm.status === "done" ? fm.done_at || fm.completed_at : fm.dismissed_at;
      if (!handledAt) continue;
      const t = new Date(handledAt).getTime();
      if (!Number.isFinite(t) || t < handledCutoffMs) continue;
      handled.push({
        id: fm.id,
        title: deriveTitle(fm, parsed.why_matters),
        handled_at: handledAt
      });
    }
  }
  return { open, handled, snoozedCount, maxUpdatedAt };
}
function sortOpen(open) {
  open.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 99;
    const pb = PRIORITY_RANK[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return (a.due_by ?? "z").localeCompare(b.due_by ?? "z");
  });
}
function sortHandled(handled) {
  handled.sort(
    (a, b) => a.handled_at < b.handled_at ? 1 : a.handled_at > b.handled_at ? -1 : 0
  );
}
async function handleTriageView(_args, ctx) {
  const handledDays = DEFAULT_HANDLED_DAYS;
  const limit = DEFAULT_LIMIT;
  const handledCutoffMs = ctx.now().getTime() - handledDays * 864e5;
  const personalActionsPrefix = "actions";
  const indexExists = await ctx.fs.exists(`${personalActionsPrefix}/_index.md`);
  if (!indexExists) {
    return {
      structuredContent: {
        error: "actions_index_missing"
      }
    };
  }
  const scan = await processActionsDir(
    ctx,
    personalActionsPrefix,
    handledCutoffMs
  );
  sortOpen(scan.open);
  sortHandled(scan.handled);
  const truncated = scan.open.length > limit;
  const actionsCapped = truncated ? scan.open.slice(0, limit) : scan.open;
  const handledCapped = scan.handled.slice(0, MAX_HANDLED_RECENT);
  const openCount = scan.open.filter((a) => a.status === "open").length;
  const lastUpdatedAt = scan.maxUpdatedAt || ctx.now().toISOString();
  const bootstrapMode = scan.open.length === 0 && scan.handled.length === 0;
  return {
    structuredContent: {
      actions: actionsCapped,
      handled_recent: handledCapped,
      counts: {
        open: openCount,
        snoozed: scan.snoozedCount,
        handled_recent: handledCapped.length,
        truncated
      },
      last_updated_at: lastUpdatedAt,
      bootstrap_mode: bootstrapMode
    }
  };
}
var triageView = {
  descriptor: {
    name: "agntux_core_triage_view",
    description: "Render the AgntUX triage UI populated with priority-sorted open action items and the most recently-handled items. Zero arguments \u2014 call with `{}`. Use when the user types `/agntux triage-digest`, or asks any of: 'show triage' / 'what's hot' / 'what should I look at' / 'what's on my plate' / 'triage me' / 'show me my action items' / 'what should I do today' / 'what do I need to handle'.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: {
        actions: { type: "array" },
        handled_recent: { type: "array" },
        counts: { type: "object" },
        last_updated_at: { type: "string" },
        bootstrap_mode: { type: "boolean" },
        error: { type: "string" }
      },
      additionalProperties: true
    },
    ui_resource_uri: TRIAGE_RESOURCE_URI
    // NOTE: `data_paths` lives in the manifest layer per ViewToolDescriptor's
    // contract (see context.ts). emit-manifest.mjs supplies the canonical
    // personal-actions default at build time, so it is NOT carried on the
    // runtime descriptor.
  },
  handle: handleTriageView
};
var mod = {
  viewTools: [triageView]
};
var agntux_core_view_default = mod;
export {
  agntux_core_view_default as default,
  isActionFilePath,
  shouldFetchForTriage
};

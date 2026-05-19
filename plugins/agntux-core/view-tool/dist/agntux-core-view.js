// src/agntux-core-view.ts
import {
  parseActionFile,
  renderConfirmationText
} from "@agntux/plugin-runtime";

// src/tools/frontmatter.ts
var FM_OPEN = /^---\n/;
function setFrontmatter(raw, patch) {
  const openMatch = FM_OPEN.exec(raw);
  if (!openMatch) throw new Error("File has no frontmatter opening ---");
  const afterOpen = raw.slice(openMatch[0].length);
  const closeIdx = afterOpen.indexOf("\n---\n");
  if (closeIdx === -1) throw new Error("File has no frontmatter closing ---");
  const yamlBlock = afterOpen.slice(0, closeIdx);
  const body = afterOpen.slice(closeIdx + "\n---\n".length);
  const pairs = [];
  const seenKeys = /* @__PURE__ */ new Set();
  for (const line of yamlBlock.split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (m) {
      pairs.push([m[1], m[2]]);
      seenKeys.add(m[1]);
    } else {
      pairs.push(["", line]);
    }
  }
  const newKeys = [];
  for (const key of Object.keys(patch)) {
    if (!seenKeys.has(key)) newKeys.push(key);
  }
  const patchedPairs = pairs.map(([key, rawVal]) => {
    if (key && Object.hasOwn(patch, key)) {
      return [key, serialiseValue(patch[key])];
    }
    return [key, rawVal];
  });
  for (const key of newKeys) {
    patchedPairs.push([key, serialiseValue(patch[key])]);
  }
  const newYaml = patchedPairs.map(([key, val]) => key ? `${key}: ${val}` : val).join("\n");
  return `---
${newYaml}
---
${body}`;
}
var ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
function serialiseValue(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (ISO_TIMESTAMP_RE.test(v)) return v;
    if (v === "" || v === "null" || v === "true" || v === "false" || /^[-+]?\d/.test(v) || v.includes(":") || v.includes("#") || v.startsWith(" ") || v.endsWith(" ")) {
      return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return v;
  }
  return JSON.stringify(v);
}

// src/tools/outcome.ts
function appendOutcomeSection(fileBody, outcome, outcomeNote, nowIso) {
  const trimmed = fileBody.trimEnd();
  const noteSuffix = outcomeNote ? ` \u2014 ${outcomeNote}` : "";
  return `${trimmed}

## Outcome
${outcome} \u2014 ${nowIso}${noteSuffix}
`;
}

// src/tools/scope.ts
var SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
var ID_RE = /^[a-z0-9][a-z0-9.\-]{0,127}$/;
function resolveActionsDir(scope) {
  if (scope?.team_slug && scope?.view_slug) {
    throw new Error(
      "Pass at most one of team_slug or view_slug, not both."
    );
  }
  if (scope?.team_slug) {
    if (!SLUG_RE.test(scope.team_slug)) {
      throw new Error(`Invalid team_slug "${scope.team_slug}".`);
    }
    return `teams/${scope.team_slug}/actions`;
  }
  if (scope?.view_slug) {
    if (!SLUG_RE.test(scope.view_slug)) {
      throw new Error(`Invalid view_slug "${scope.view_slug}".`);
    }
    return `leader-views/${scope.view_slug}/actions`;
  }
  return "actions";
}
function resolveActionPath(id, scope) {
  if (typeof id !== "string" || !ID_RE.test(id) || id.includes("..")) {
    throw new Error(
      `Path traversal rejected: invalid action id "${id}".`
    );
  }
  const dir = resolveActionsDir(scope);
  const direct = `${dir}/${id}.md`;
  const normalized = direct.replace(/\/+/g, "/");
  if (direct !== normalized) {
    throw new Error(
      `Path traversal rejected: id "${id}" resolves outside the action scope.`
    );
  }
  return direct;
}
var SCOPE_INPUT_SCHEMA_FRAGMENT = {
  team_slug: {
    type: "string",
    description: "Optional. Route the write to `teams/{team_slug}/actions/` instead of personal. Mutually exclusive with view_slug."
  },
  view_slug: {
    type: "string",
    description: "Optional. Route the write to `leader-views/{view_slug}/actions/` instead of personal. Mutually exclusive with team_slug."
  }
};
function readScopeFromArgs(args) {
  const team_slug = typeof args.team_slug === "string" ? args.team_slug.trim() : "";
  const view_slug = typeof args.view_slug === "string" ? args.view_slug.trim() : "";
  if (team_slug && view_slug) {
    throw new Error(
      "Pass at most one of team_slug or view_slug, not both."
    );
  }
  if (team_slug) return { team_slug };
  if (view_slug) return { view_slug };
  return void 0;
}
function describeScope(scope) {
  if (scope?.team_slug) return ` (team: ${scope.team_slug})`;
  if (scope?.view_slug) return ` (view: ${scope.view_slug})`;
  return "";
}

// src/tools/dismiss.ts
var dismissTool = {
  descriptor: {
    name: "agntux_core_dismiss",
    description: "Dismiss an action item (mark it as not worth acting on). Optionally captures user intent via `outcome` \u2014 `noise`, `irrelevant`, `completed-externally`, or any free-form string \u2014 appended as an `## Outcome` body section. pattern-feedback reads this to distinguish genuine noise from completion-elsewhere; without an outcome, the dismissal is treated as ambiguous. Defaults to the personal `actions/` scope; pass `team_slug` or `view_slug` to dismiss a team- or leader-view-scoped item instead (team mode).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Action item ID (filename without .md)"
        },
        outcome: {
          type: "string",
          description: "Optional intent marker. Suggested: `noise`, `irrelevant`, `completed-externally`. Free-form strings allowed. Appends a `## Outcome` body section."
        },
        outcome_note: {
          type: "string",
          description: "Optional free-form note appended to the `## Outcome` body section."
        },
        ...SCOPE_INPUT_SCHEMA_FRAGMENT
      },
      required: ["id"],
      additionalProperties: false
    }
  },
  async handle(args, ctx) {
    const id = String(args.id ?? "");
    if (!id) throw new Error("id is required");
    const scope = readScopeFromArgs(args);
    const filePath = resolveActionPath(id, scope);
    const outcomeArg = typeof args.outcome === "string" ? args.outcome.trim() : "";
    const outcomeNote = typeof args.outcome_note === "string" ? args.outcome_note.trim() : void 0;
    await ctx.fs.update(filePath, (current) => {
      if (current === null) {
        throw new Error(`action ${id} not found`);
      }
      let updated = setFrontmatter(current, {
        status: "dismissed",
        dismissed_at: ctx.now().toISOString(),
        completed_at: null
      });
      if (outcomeArg) {
        updated = appendOutcomeSection(
          updated,
          outcomeArg,
          outcomeNote,
          ctx.now().toISOString()
        );
      }
      return updated;
    });
    const suffix = outcomeArg ? ` (outcome: ${outcomeArg})` : "";
    return {
      content: [
        {
          type: "text",
          text: `Dismissed ${id}${suffix}${describeScope(scope)}.`
        }
      ]
    };
  }
};

// src/tools/set-status.ts
var VALID_STATUSES = /* @__PURE__ */ new Set(["open", "snoozed", "done", "dismissed"]);
var setStatusTool = {
  descriptor: {
    name: "agntux_core_set_status",
    description: "Set the status of an action item (open, snoozed, done, or dismissed). Optionally captures user intent via `outcome` \u2014 `completed-externally`, `noise`, `irrelevant`, or any free-form string \u2014 appended as an `## Outcome` body section. pattern-feedback reads this to distinguish positive dismissals from negative. Defaults to the personal `actions/` scope; pass `team_slug` or `view_slug` to mutate a team- or leader-view-scoped item instead (team mode). For team / leader-view scoped mark-done, also writes `done_by_user_slug`, `done_by_user_id`, and `done_at` when `user_slug` / `user_id` are provided \u2014 these are the team-wide audit fields visible to every member after sync.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Action item ID (filename without .md)"
        },
        status: {
          type: "string",
          enum: ["open", "snoozed", "done", "dismissed"]
        },
        snoozed_until: {
          type: "string",
          description: "Required when status=snoozed. ISO 8601 timestamp."
        },
        outcome: {
          type: "string",
          description: "Optional intent marker for done/dismissed transitions. Suggested values: `completed-externally`, `noise`, `irrelevant`. Free-form strings allowed."
        },
        outcome_note: {
          type: "string",
          description: "Optional free-form note appended to the `## Outcome` body section."
        },
        user_slug: {
          type: "string",
          description: "Optional. The slug of the user performing the action. Used for team-wide audit fields (done_by_user_slug)."
        },
        user_id: {
          type: "string",
          description: "Optional. The id of the user performing the action. Used for team-wide audit fields (done_by_user_id)."
        },
        ...SCOPE_INPUT_SCHEMA_FRAGMENT
      },
      required: ["id", "status"],
      additionalProperties: false
    }
  },
  async handle(args, ctx) {
    const id = String(args.id ?? "");
    const status = String(args.status ?? "");
    if (!id) throw new Error("id is required");
    if (!VALID_STATUSES.has(status)) {
      throw new Error(
        `Invalid status "${status}". Must be one of: open, snoozed, done, dismissed`
      );
    }
    if (status === "snoozed" && !args.snoozed_until) {
      throw new Error("snoozed_until is required when status=snoozed");
    }
    const scope = readScopeFromArgs(args);
    const filePath = resolveActionPath(id, scope);
    const userSlug = typeof args.user_slug === "string" ? args.user_slug.trim() : "";
    const userId = typeof args.user_id === "string" ? args.user_id.trim() : "";
    const outcomeArg = typeof args.outcome === "string" ? args.outcome.trim() : "";
    const outcomeNote = typeof args.outcome_note === "string" ? args.outcome_note.trim() : void 0;
    const teamScoped = Boolean(scope?.team_slug || scope?.view_slug);
    await ctx.fs.update(filePath, (current) => {
      if (current === null) {
        throw new Error(`action ${id} not found`);
      }
      const now = ctx.now().toISOString();
      const patch = { status };
      if (status === "open") {
        patch.completed_at = null;
        patch.snoozed_until = null;
        patch.dismissed_at = null;
        if (teamScoped) {
          patch.done_by_user_slug = null;
          patch.done_by_user_id = null;
          patch.done_at = null;
        }
      } else if (status === "done") {
        patch.completed_at = now;
        patch.snoozed_until = null;
        patch.dismissed_at = null;
        if (teamScoped) {
          if (userSlug) patch.done_by_user_slug = userSlug;
          if (userId) patch.done_by_user_id = userId;
          patch.done_at = now;
        }
      } else if (status === "dismissed") {
        patch.dismissed_at = now;
        patch.snoozed_until = null;
        patch.completed_at = null;
        if (teamScoped) {
          patch.done_by_user_slug = null;
          patch.done_by_user_id = null;
          patch.done_at = null;
        }
      } else if (status === "snoozed") {
        patch.snoozed_until = String(args.snoozed_until ?? "");
        patch.completed_at = null;
        patch.dismissed_at = null;
        if (teamScoped) {
          patch.done_by_user_slug = null;
          patch.done_by_user_id = null;
          patch.done_at = null;
        }
      }
      let updated = setFrontmatter(current, patch);
      if (outcomeArg && (status === "done" || status === "dismissed")) {
        updated = appendOutcomeSection(updated, outcomeArg, outcomeNote, now);
      }
      return updated;
    });
    const outcomeSuffix = outcomeArg && (status === "done" || status === "dismissed") ? ` (outcome: ${outcomeArg})` : "";
    return {
      content: [
        {
          type: "text",
          text: `Set ${id} \u2192 ${status}${outcomeSuffix}${describeScope(scope)}.`
        }
      ]
    };
  }
};

// src/tools/snooze.ts
var snoozeTool = {
  descriptor: {
    name: "agntux_core_snooze",
    description: "Snooze an action item until a specified date. Defaults to the personal `actions/` scope; pass `team_slug` or `view_slug` to snooze a team- or leader-view-scoped item instead. (team mode).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Action item ID (filename without .md)"
        },
        until: {
          type: "string",
          description: "ISO date or RFC 3339 timestamp"
        },
        ...SCOPE_INPUT_SCHEMA_FRAGMENT
      },
      required: ["id", "until"],
      additionalProperties: false
    }
  },
  async handle(args, ctx) {
    const id = String(args.id ?? "");
    const until = String(args.until ?? "");
    if (!id) throw new Error("id is required");
    if (!until) throw new Error("until is required");
    const scope = readScopeFromArgs(args);
    const filePath = resolveActionPath(id, scope);
    await ctx.fs.update(filePath, (current) => {
      if (current === null) {
        throw new Error(`action ${id} not found`);
      }
      return setFrontmatter(current, {
        status: "snoozed",
        snoozed_until: until,
        completed_at: null,
        dismissed_at: null
      });
    });
    return {
      content: [
        {
          type: "text",
          text: `Snoozed ${id} until ${until}${describeScope(scope)}.`
        }
      ]
    };
  }
};

// src/tools/triage-prefs.ts
var PREFS_PATH = ".agntux/triage-prefs.json";
var SLUG_RE2 = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
var MAX_MUTED_SLUGS = 256;
var MAX_TRIAGE_STATE_ENTRIES = 4096;
var TRIAGE_STATE_PATH_RE = /^(actions|teams\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\/actions|leader-views\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\/actions)\/[^/\\\0]{1,200}\.md$/;
var VALID_SORTS = /* @__PURE__ */ new Set([
  "priority",
  "due",
  "created",
  "team-then-priority",
  "due-then-priority"
]);
var VALID_FILTER_STATES = /* @__PURE__ */ new Set(["shown", "hidden"]);
var ISO_TIMESTAMP_RE2 = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
function emptyPrefs() {
  return {
    schema_version: 2,
    muted_team_slugs: [],
    muted_view_slugs: [],
    team_filters: {},
    view_filters: {},
    relevance_class_filters: {},
    sort: "priority",
    show_done: false,
    show_snoozed: false,
    show_dismissed: false,
    triage_state: {}
  };
}
function sanitizeSlugList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || !SLUG_RE2.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_MUTED_SLUGS) break;
  }
  return out;
}
function sanitizeFilterMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== "string" || !SLUG_RE2.test(k)) continue;
    if (typeof v !== "string" || !VALID_FILTER_STATES.has(v)) continue;
    out[k] = v;
    count++;
    if (count >= MAX_MUTED_SLUGS) break;
  }
  return out;
}
function sanitizeRelevanceClassFilters(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== "string" || !SLUG_RE2.test(k)) continue;
    out[k] = sanitizeSlugList(v);
    count++;
    if (count >= MAX_MUTED_SLUGS) break;
  }
  return out;
}
function sanitizeIsoOrNull(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length > 64) return null;
  if (!ISO_TIMESTAMP_RE2.test(t)) return null;
  if (!Number.isFinite(Date.parse(t))) return null;
  return t;
}
function isValidTriageStatePath(p) {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > 512) return false;
  if (p.includes("..")) return false;
  return TRIAGE_STATE_PATH_RE.test(p);
}
function sanitizeTriageState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!isValidTriageStatePath(k)) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const entry = v;
    out[k] = {
      snoozed_until: sanitizeIsoOrNull(entry.snoozed_until),
      dismissed_at: sanitizeIsoOrNull(entry.dismissed_at)
    };
    count++;
    if (count >= MAX_TRIAGE_STATE_ENTRIES) break;
  }
  return out;
}
function parsePrefs(raw) {
  if (raw === null) return emptyPrefs();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyPrefs();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyPrefs();
  }
  const obj = parsed;
  const muted_team_slugs = sanitizeSlugList(obj.muted_team_slugs);
  const muted_view_slugs = sanitizeSlugList(obj.muted_view_slugs);
  const team_filters = sanitizeFilterMap(obj.team_filters);
  const view_filters = sanitizeFilterMap(obj.view_filters);
  for (const slug of muted_team_slugs) {
    if (team_filters[slug] === void 0) team_filters[slug] = "hidden";
  }
  for (const slug of muted_view_slugs) {
    if (view_filters[slug] === void 0) view_filters[slug] = "hidden";
  }
  const sort = typeof obj.sort === "string" && VALID_SORTS.has(obj.sort) ? obj.sort : "priority";
  return {
    schema_version: 2,
    muted_team_slugs,
    muted_view_slugs,
    team_filters,
    view_filters,
    relevance_class_filters: sanitizeRelevanceClassFilters(
      obj.relevance_class_filters
    ),
    sort,
    show_done: obj.show_done === true,
    show_snoozed: obj.show_snoozed === true,
    show_dismissed: obj.show_dismissed === true,
    triage_state: sanitizeTriageState(obj.triage_state)
  };
}
function serialisePrefs(prefs) {
  const muted_team_slugs = [];
  for (const [slug, state] of Object.entries(prefs.team_filters)) {
    if (state === "hidden") muted_team_slugs.push(slug);
  }
  const muted_view_slugs = [];
  for (const [slug, state] of Object.entries(prefs.view_filters)) {
    if (state === "hidden") muted_view_slugs.push(slug);
  }
  const out = { ...prefs, muted_team_slugs, muted_view_slugs };
  return JSON.stringify(out, null, 2) + "\n";
}
var savePrefsTool = {
  descriptor: {
    name: "agntux_core_save_triage_prefs",
    description: "Persist the triage UI's filter state to `.agntux/triage-prefs.json`. Called by the triage MCP App when the user toggles a team filter chip, a relevance-class chip, or a show-done/snoozed/dismissed toggle; not user-facing. MERGES patch fields into the existing file \u2014 callers may patch a single field without re-sending the whole state.",
    inputSchema: {
      type: "object",
      properties: {
        muted_team_slugs: {
          type: "array",
          items: { type: "string" },
          description: "Legacy v1 field \u2014 flat array of team slugs the user has hidden. Translated to `team_filters[slug] = 'hidden'` on write."
        },
        muted_view_slugs: {
          type: "array",
          items: { type: "string" },
          description: "Legacy v1 field \u2014 flat array of view slugs the user has hidden. Translated to `view_filters[slug] = 'hidden'` on write."
        },
        team_filters: {
          type: "object",
          description: "Map of team-slug \u2192 'shown' | 'hidden'. Patches the existing map."
        },
        view_filters: {
          type: "object",
          description: "Map of view-slug \u2192 'shown' | 'hidden'. Patches the existing map."
        },
        relevance_class_filters: {
          type: "object",
          description: "Map of team-slug \u2192 array of selected relevance-class slugs."
        },
        sort: {
          type: "string",
          description: "Sort key. One of: priority, due, created, team-then-priority, due-then-priority."
        },
        show_done: { type: "boolean" },
        show_snoozed: { type: "boolean" },
        show_dismissed: { type: "boolean" }
      },
      required: [],
      additionalProperties: false
    }
  },
  async handle(args, ctx) {
    await ctx.fs.update(PREFS_PATH, (current) => {
      const prefs = parsePrefs(current);
      const next = {
        ...prefs,
        team_filters: { ...prefs.team_filters },
        view_filters: { ...prefs.view_filters },
        relevance_class_filters: { ...prefs.relevance_class_filters },
        triage_state: { ...prefs.triage_state }
      };
      if (args.muted_team_slugs !== void 0) {
        const muted = sanitizeSlugList(args.muted_team_slugs);
        const filters = {};
        for (const slug of muted) filters[slug] = "hidden";
        for (const [slug, state] of Object.entries(next.team_filters)) {
          if (state === "shown" && filters[slug] === void 0)
            filters[slug] = "shown";
        }
        next.team_filters = filters;
      }
      if (args.muted_view_slugs !== void 0) {
        const muted = sanitizeSlugList(args.muted_view_slugs);
        const filters = {};
        for (const slug of muted) filters[slug] = "hidden";
        for (const [slug, state] of Object.entries(next.view_filters)) {
          if (state === "shown" && filters[slug] === void 0)
            filters[slug] = "shown";
        }
        next.view_filters = filters;
      }
      if (args.team_filters !== void 0) {
        const patch = sanitizeFilterMap(args.team_filters);
        for (const [k, v] of Object.entries(patch))
          next.team_filters[k] = v;
      }
      if (args.view_filters !== void 0) {
        const patch = sanitizeFilterMap(args.view_filters);
        for (const [k, v] of Object.entries(patch))
          next.view_filters[k] = v;
      }
      if (args.relevance_class_filters !== void 0) {
        const patch = sanitizeRelevanceClassFilters(
          args.relevance_class_filters
        );
        for (const [k, v] of Object.entries(patch))
          next.relevance_class_filters[k] = v;
      }
      if (typeof args.sort === "string" && VALID_SORTS.has(args.sort)) {
        next.sort = args.sort;
      }
      if (typeof args.show_done === "boolean") next.show_done = args.show_done;
      if (typeof args.show_snoozed === "boolean")
        next.show_snoozed = args.show_snoozed;
      if (typeof args.show_dismissed === "boolean")
        next.show_dismissed = args.show_dismissed;
      return serialisePrefs(next);
    });
    return {
      content: [
        {
          type: "text",
          text: "triage-prefs.json saved."
        }
      ]
    };
  }
};
var setPrefTool = {
  descriptor: {
    name: "agntux_core_set_triage_pref",
    description: "Set the per-path triage state (snooze / dismiss) for a specific action file. Writes `.agntux/triage-prefs.json` \u2192 `triage_state[path]`. PERSONAL: the action file is untouched, so a team item snoozed by Alice still appears in Bob's triage. Pass `path` (relative to AgntUX root, e.g. `teams/platform/actions/2026-05-12-foo.md`) and at least one of `snoozed_until`, `dismissed_at`. Pass `null` for a field to clear it; both null removes the entry.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the action file, relative to the AgntUX project root."
        },
        snoozed_until: {
          description: "RFC 3339 timestamp when the snooze ends. Pass `null` to clear. Omit to leave unchanged."
        },
        dismissed_at: {
          description: "RFC 3339 timestamp when dismissed. Pass `null` to clear. Omit to leave unchanged."
        }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  async handle(args, ctx) {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) throw new Error("path is required");
    if (!isValidTriageStatePath(path)) {
      throw new Error(
        `Path traversal rejected: invalid triage-prefs path "${path}".`
      );
    }
    await ctx.fs.update(PREFS_PATH, (current) => {
      const prefs = parsePrefs(current);
      const next = {
        ...prefs,
        triage_state: { ...prefs.triage_state }
      };
      const existing = next.triage_state[path] ?? {
        snoozed_until: null,
        dismissed_at: null
      };
      let snoozed_until = existing.snoozed_until;
      let dismissed_at = existing.dismissed_at;
      if (Object.hasOwn(args, "snoozed_until")) {
        snoozed_until = sanitizeIsoOrNull(args.snoozed_until);
      }
      if (Object.hasOwn(args, "dismissed_at")) {
        dismissed_at = sanitizeIsoOrNull(args.dismissed_at);
      }
      if (snoozed_until === null && dismissed_at === null) {
        delete next.triage_state[path];
      } else {
        next.triage_state[path] = { snoozed_until, dismissed_at };
      }
      return serialisePrefs(next);
    });
    return {
      content: [
        {
          type: "text",
          text: `triage-prefs.json updated for ${path}.`
        }
      ]
    };
  }
};

// src/agntux-core-view.ts
var TRIAGE_RESOURCE_URI = "ui://agntux-core/triage";
var TRIAGE_UI_LABEL = "AgntUX triage UI";
var DEFAULT_LIMIT = 30;
var DEFAULT_HANDLED_DAYS = 7;
var MAX_HANDLED_RECENT = 10;
var MAX_RELATED_ENTITIES = 6;
var MAX_SUGGESTED_ACTIONS = 4;
var MAX_SUMMARY_CHARS = 200;
var MAX_TITLE_CHARS = 120;
var MAX_EXCERPT_CHARS = 220;
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
function asHandledStatus(v) {
  return v === "dismissed" ? "dismissed" : "done";
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
      const fit = parsed.personalization_fit;
      const row = {
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
          MAX_SUGGESTED_ACTIONS
        ),
        why_matters_excerpt: truncate(why, MAX_EXCERPT_CHARS),
        personalization_fit_excerpt: truncate(fit, MAX_EXCERPT_CHARS),
        created_at: fm.created_at || null,
        updated_at: fm.updated_at || null
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
        priority: asPriority(fm.priority),
        status: asHandledStatus(fm.status),
        handled_at: handledAt,
        outcome: null
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
      content: [
        { type: "text", text: renderConfirmationText(TRIAGE_UI_LABEL) }
      ],
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
    content: [
      { type: "text", text: renderConfirmationText(TRIAGE_UI_LABEL) }
    ],
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
    description: "Render the AgntUX triage UI populated with priority-sorted open action items and the most recently-handled items. Zero arguments \u2014 call with `{}`. Use when the user types `/agntux triage-digest`, or asks any of: 'show triage' / 'what's hot' / 'what should I look at' / 'what's on my plate' / 'triage me' / 'show me my action items' / 'what should I do today' / 'what do I need to handle'. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
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
  viewTools: [triageView],
  mutationTools: [
    snoozeTool,
    dismissTool,
    setStatusTool,
    savePrefsTool,
    setPrefTool
  ]
};
var agntux_core_view_default = mod;
export {
  agntux_core_view_default as default,
  isActionFilePath,
  shouldFetchForTriage
};

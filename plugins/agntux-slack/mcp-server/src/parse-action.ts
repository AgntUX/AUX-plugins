// =============================================================================
// parse-action — read an action item file and surface the fields the triage
// view tool needs. Stateless, read-only; never writes to disk.
//
// Frontmatter is parsed via the `yaml` package; body sections (`## Why this
// matters`, `## Personalization fit`, `## Compose payload`,
// `## Canvas payload`) are extracted by header lookup. The two payload
// sections wrap a fenced ```yaml block whose shape mirrors compose-view /
// canvas-view's structuredContent contract.
// =============================================================================

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export interface SuggestedActionRow {
  label: string;
  host_prompt: string;
}

export interface ActionFrontmatter {
  id: string;
  status: string;
  priority: string;
  reason_class: string;
  reason_detail: string;
  source: string | null;
  source_ref: string | null;
  related_entities: string[];
  suggested_actions: SuggestedActionRow[];
  due_by: string | null;
  snoozed_until: string | null;
  completed_at: string | null;
  dismissed_at: string | null;
  created_at: string | null;
}

export interface ComposePayloadThreadContextMessage {
  ts: string;
  author: string;
  body_excerpt: string;
}

export interface ComposePayloadThreadContext {
  parent_ts: string;
  parent_author_real_name: string;
  parent_excerpt: string;
  last_reply_ts: string | null;
  last_reply_author_real_name: string | null;
  last_reply_excerpt: string | null;
  total_replies: number;
  participants: string[];
  messages_preview: ComposePayloadThreadContextMessage[];
}

export interface ComposePayloadChannel {
  id: string;
  name: string;
  is_dm: boolean;
}

export interface ComposePayload {
  drafted_body: string;
  personalization_signals: string[];
  thread_context: ComposePayloadThreadContext;
  channel: ComposePayloadChannel;
  slack_permalink: string | null;
  generated_at: string | null;
}

export interface CanvasPayloadDrafted {
  title: string;
  tldr: string;
  decisions: string[];
  open_questions: string[];
  participants: string[];
}

export interface CanvasPayloadChannel {
  id: string;
  name: string;
}

export interface CanvasPayloadThread {
  parent_ts: string;
  total_replies: number;
  participants: string[];
}

export interface CanvasPayload {
  drafted_canvas: CanvasPayloadDrafted;
  channel: CanvasPayloadChannel;
  thread: CanvasPayloadThread;
  proposed_followup_message: string;
  generated_at: string | null;
}

export interface ParsedAction {
  frontmatter: ActionFrontmatter;
  why_matters: string;
  personalization_fit: string;
  compose_payload: ComposePayload | null;
  canvas_payload: CanvasPayload | null;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

const FALLBACK_FRONTMATTER: ActionFrontmatter = {
  id: "",
  status: "",
  priority: "",
  reason_class: "",
  reason_detail: "",
  source: null,
  source_ref: null,
  related_entities: [],
  suggested_actions: [],
  due_by: null,
  snoozed_until: null,
  completed_at: null,
  dismissed_at: null,
  created_at: null,
};

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asSuggestedActions(v: unknown): SuggestedActionRow[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((row): SuggestedActionRow | null => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const label = asString(r.label);
      const host_prompt = asString(r.host_prompt);
      if (!label || !host_prompt) return null;
      // Normalise newlines: YAML block scalars often end with a trailing \n.
      return { label, host_prompt: host_prompt.trimEnd() };
    })
    .filter((row): row is SuggestedActionRow => row !== null);
}

export function parseFrontmatter(text: string): {
  frontmatter: ActionFrontmatter;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) {
    return { frontmatter: { ...FALLBACK_FRONTMATTER }, body: text };
  }
  const yamlBlock = match[1];
  const body = match[2];
  let raw: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(yamlBlock);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      raw = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed YAML: fall through with empty raw — caller surfaces a graceful
    // error path instead of throwing.
  }
  return {
    frontmatter: {
      id: asString(raw.id),
      status: asString(raw.status),
      priority: asString(raw.priority),
      reason_class: asString(raw.reason_class),
      reason_detail: asString(raw.reason_detail),
      source: asStringOrNull(raw.source),
      source_ref: asStringOrNull(raw.source_ref),
      related_entities: asStringArray(raw.related_entities),
      suggested_actions: asSuggestedActions(raw.suggested_actions),
      due_by: asStringOrNull(raw.due_by),
      snoozed_until: asStringOrNull(raw.snoozed_until),
      completed_at: asStringOrNull(raw.completed_at),
      dismissed_at: asStringOrNull(raw.dismissed_at),
      created_at: asStringOrNull(raw.created_at),
    },
    body,
  };
}

// Extract the prose under a top-level body section (e.g. `## Why this matters`).
// Returns the section's plain text up to the next `## ` header, or the empty
// string when the section is absent. Trims leading/trailing whitespace.
export function extractSection(body: string, header: string): string {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^##\\s+${escaped}\\s*$`, "m");
  const match = re.exec(body);
  if (!match) return "";
  const start = match.index + match[0].length;
  const after = body.slice(start);
  // Find the next `## ` header (any character class) to know where to stop.
  const nextHeader = /^##\s+/m.exec(after);
  const sliceEnd = nextHeader ? nextHeader.index : after.length;
  return after.slice(0, sliceEnd).trim();
}

// Lift a YAML object out of a fenced ```yaml block under a `## ` header.
// Returns the parsed object, or null when the header is absent, the fenced
// block can't be located, or YAML parse fails. Mirrors agntux-core's
// section-extraction idiom; the schema-validation work is the caller's.
export function parseBodySection(
  body: string,
  header: string,
): Record<string, unknown> | null {
  const section = extractSection(body, header);
  if (!section) return null;
  // Match a fenced YAML block; tolerate ```yml as an alias and stray
  // whitespace after the opening fence. The closing fence must be the first
  // bare ``` line at column zero.
  const fenceRe = /^```ya?ml\s*\n([\s\S]*?)\n```\s*$/m;
  const match = fenceRe.exec(section);
  if (!match) return null;
  const yamlText = match[1];
  try {
    const parsed = parseYaml(yamlText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asBoolean(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function normalizeMessagesPreview(
  v: unknown,
): ComposePayloadThreadContextMessage[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item): ComposePayloadThreadContextMessage | null => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      return {
        ts: asString(r.ts),
        author: asString(r.author),
        body_excerpt: asString(r.body_excerpt),
      };
    })
    .filter(
      (x): x is ComposePayloadThreadContextMessage => x !== null,
    );
}

function normalizeComposePayload(
  raw: Record<string, unknown> | null,
): ComposePayload | null {
  if (!raw) return null;
  const tcRaw =
    raw.thread_context && typeof raw.thread_context === "object"
      ? (raw.thread_context as Record<string, unknown>)
      : {};
  const channelRaw =
    raw.channel && typeof raw.channel === "object"
      ? (raw.channel as Record<string, unknown>)
      : {};
  const draftedBody = asString(raw.drafted_body);
  if (!draftedBody) return null;
  return {
    drafted_body: draftedBody,
    personalization_signals: asStringArray(raw.personalization_signals),
    thread_context: {
      parent_ts: asString(tcRaw.parent_ts),
      parent_author_real_name: asString(tcRaw.parent_author_real_name),
      parent_excerpt: asString(tcRaw.parent_excerpt),
      last_reply_ts: asStringOrNull(tcRaw.last_reply_ts),
      last_reply_author_real_name: asStringOrNull(
        tcRaw.last_reply_author_real_name,
      ),
      last_reply_excerpt: asStringOrNull(tcRaw.last_reply_excerpt),
      total_replies: asNumber(tcRaw.total_replies),
      participants: asStringArray(tcRaw.participants),
      messages_preview: normalizeMessagesPreview(tcRaw.messages_preview),
    },
    channel: {
      id: asString(channelRaw.id),
      name: asString(channelRaw.name),
      is_dm: asBoolean(channelRaw.is_dm),
    },
    slack_permalink: asStringOrNull(raw.slack_permalink),
    generated_at: asStringOrNull(raw.generated_at),
  };
}

function normalizeCanvasPayload(
  raw: Record<string, unknown> | null,
): CanvasPayload | null {
  if (!raw) return null;
  const draftedRaw =
    raw.drafted_canvas && typeof raw.drafted_canvas === "object"
      ? (raw.drafted_canvas as Record<string, unknown>)
      : {};
  const channelRaw =
    raw.channel && typeof raw.channel === "object"
      ? (raw.channel as Record<string, unknown>)
      : {};
  const threadRaw =
    raw.thread && typeof raw.thread === "object"
      ? (raw.thread as Record<string, unknown>)
      : {};
  const title = asString(draftedRaw.title);
  if (!title) return null;
  return {
    drafted_canvas: {
      title,
      tldr: asString(draftedRaw.tldr),
      decisions: asStringArray(draftedRaw.decisions),
      open_questions: asStringArray(draftedRaw.open_questions),
      participants: asStringArray(draftedRaw.participants),
    },
    channel: {
      id: asString(channelRaw.id),
      name: asString(channelRaw.name),
    },
    thread: {
      parent_ts: asString(threadRaw.parent_ts),
      total_replies: asNumber(threadRaw.total_replies),
      participants: asStringArray(threadRaw.participants),
    },
    proposed_followup_message: asString(raw.proposed_followup_message),
    generated_at: asStringOrNull(raw.generated_at),
  };
}

export function parseActionFile(filePath: string): ParsedAction {
  const text = readFileSync(filePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(text);
  return {
    frontmatter,
    why_matters: extractSection(body, "Why this matters"),
    personalization_fit: extractSection(body, "Personalization fit"),
    compose_payload: normalizeComposePayload(
      parseBodySection(body, "Compose payload"),
    ),
    canvas_payload: normalizeCanvasPayload(
      parseBodySection(body, "Canvas payload"),
    ),
  };
}

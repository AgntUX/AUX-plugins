// =============================================================================
// parse-action — read an action item file and surface the fields the gmail
// compose view tool needs. Stateless, read-only; never writes to disk.
//
// Frontmatter is parsed via the `yaml` package; body sections (`## Why this
// matters`, `## Personalization fit`, `## Email context`, `## Compose payload`)
// are extracted by header lookup.
//
// The compose payload section can appear under either of two headers:
//   - `## Compose payload` — when the action was authored by agntux-gmail's
//     own ingest run (the canonical case).
//   - `## Compose payload (gmail)` — when the action was authored by another
//     plugin's ingest run and agntux-gmail merged into it via Step 9's
//     cross-source merge protocol. The namespace suffix prevents collision
//     with a sibling `## Compose payload (slack)` block on the same file.
// We look up the namespaced header first, then fall back to the bare header.
// =============================================================================

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export interface SuggestedActionRow {
  label: string;
  host_prompt?: string;
  url?: string;
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

export interface ComposePayloadParticipant {
  real_name: string;
  email: string;
}

export interface ComposePayloadThreadContext {
  thread_id: string;
  subject: string;
  parent_message_id: string;
  parent_author_real_name: string;
  parent_author_email: string;
  parent_excerpt: string;
  last_message_id: string;
  last_author_real_name: string;
  last_author_email: string;
  last_excerpt: string;
  total_messages: number;
  participants: ComposePayloadParticipant[];
}

export interface ComposePayloadRecipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

export interface ComposePayload {
  drafted_body: string;
  personalization_signals: string[];
  thread_context: ComposePayloadThreadContext;
  recipients: ComposePayloadRecipients;
  reply_to_message_id: string;
  gmail_thread_url: string | null;
  generated_at: string | null;
}

export interface ParsedAction {
  frontmatter: ActionFrontmatter;
  why_matters: string;
  personalization_fit: string;
  email_context: string;
  compose_payload: ComposePayload | null;
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

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asSuggestedActions(v: unknown): SuggestedActionRow[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((row): SuggestedActionRow | null => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const label = asString(r.label);
      const host_prompt = asStringOrNull(r.host_prompt);
      const url = asStringOrNull(r.url);
      if (!label) return null;
      if (!host_prompt && !url) return null;
      const out: SuggestedActionRow = { label };
      if (host_prompt) out.host_prompt = host_prompt.trimEnd();
      if (url) out.url = url;
      return out;
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

export function extractSection(body: string, header: string): string {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^##\\s+${escaped}\\s*$`, "m");
  const match = re.exec(body);
  if (!match) return "";
  const start = match.index + match[0].length;
  const after = body.slice(start);
  const nextHeader = /^##\s+/m.exec(after);
  const sliceEnd = nextHeader ? nextHeader.index : after.length;
  return after.slice(0, sliceEnd).trim();
}

export function parseBodySection(
  body: string,
  header: string,
): Record<string, unknown> | null {
  const section = extractSection(body, header);
  if (!section) return null;
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

function normalizeParticipants(v: unknown): ComposePayloadParticipant[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item): ComposePayloadParticipant | null => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const real_name = asString(r.real_name);
      const email = asString(r.email);
      if (!email) return null;
      return { real_name, email };
    })
    .filter((x): x is ComposePayloadParticipant => x !== null);
}

function normalizeRecipients(v: unknown): ComposePayloadRecipients {
  if (!v || typeof v !== "object") {
    return { to: [], cc: [], bcc: [] };
  }
  const r = v as Record<string, unknown>;
  return {
    to: asStringArray(r.to),
    cc: asStringArray(r.cc),
    bcc: asStringArray(r.bcc),
  };
}

function normalizeComposePayload(
  raw: Record<string, unknown> | null,
): ComposePayload | null {
  if (!raw) return null;
  const tcRaw =
    raw.thread_context && typeof raw.thread_context === "object"
      ? (raw.thread_context as Record<string, unknown>)
      : {};
  const draftedBody = asString(raw.drafted_body);
  if (!draftedBody) return null;
  return {
    drafted_body: draftedBody,
    personalization_signals: asStringArray(raw.personalization_signals),
    thread_context: {
      thread_id: asString(tcRaw.thread_id),
      subject: asString(tcRaw.subject),
      parent_message_id: asString(tcRaw.parent_message_id),
      parent_author_real_name: asString(tcRaw.parent_author_real_name),
      parent_author_email: asString(tcRaw.parent_author_email),
      parent_excerpt: asString(tcRaw.parent_excerpt),
      last_message_id: asString(tcRaw.last_message_id),
      last_author_real_name: asString(tcRaw.last_author_real_name),
      last_author_email: asString(tcRaw.last_author_email),
      last_excerpt: asString(tcRaw.last_excerpt),
      total_messages: asNumber(tcRaw.total_messages),
      participants: normalizeParticipants(tcRaw.participants),
    },
    recipients: normalizeRecipients(raw.recipients),
    reply_to_message_id: asString(raw.reply_to_message_id),
    gmail_thread_url: asStringOrNull(raw.gmail_thread_url),
    generated_at: asStringOrNull(raw.generated_at),
  };
}

export function parseActionFile(filePath: string): ParsedAction {
  const text = readFileSync(filePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(text);
  // Look up gmail-namespaced header first (cross-source-merged case), then
  // fall back to the bare header (gmail-authored case).
  const composeRaw =
    parseBodySection(body, "Compose payload (gmail)") ??
    parseBodySection(body, "Compose payload");
  return {
    frontmatter,
    why_matters: extractSection(body, "Why this matters"),
    personalization_fit: extractSection(body, "Personalization fit"),
    email_context: extractSection(body, "Email context"),
    compose_payload: normalizeComposePayload(composeRaw),
  };
}

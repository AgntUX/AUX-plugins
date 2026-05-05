// =============================================================================
// normalize.ts — defensive per-entity normalizers for the compose payload.
//
// Every normalizer follows briefing-learnings §1.2: one normalizer per entity,
// fan out via safeArray().map(normalizeX). All fields have typed defaults so
// undefined never propagates into JSX.
// =============================================================================

import {
  safeArray,
  safeString,
  safeNumber,
  safeBoolean,
  safeObject,
  safeEnum,
} from "./safe-accessors.js";
import type {
  ComposePayload,
  ComposeError,
  ChannelInfo,
  ThreadInfo,
  MessagePreview,
  InitialVerb,
} from "./types.js";

// ── Per-entity normalizers ────────────────────────────────────────────────────

export function normalizeChannel(raw: unknown): ChannelInfo {
  const r = safeObject(raw);
  return {
    id: safeString(r.id),
    name: safeString(r.name),
    is_dm: safeBoolean(r.is_dm),
  };
}

export function normalizeMessage(raw: unknown): MessagePreview {
  const r = safeObject(raw);
  return {
    ts: safeString(r.ts),
    author: safeString(r.author),
    body_excerpt: safeString(r.body_excerpt),
  };
}

export function normalizeThread(raw: unknown): ThreadInfo {
  const r = safeObject(raw);
  return {
    parent_ts: safeString(r.parent_ts),
    parent_author_real_name: safeString(r.parent_author_real_name),
    parent_excerpt: safeString(r.parent_excerpt),
    last_reply_ts:
      typeof r.last_reply_ts === "string" ? r.last_reply_ts : null,
    last_reply_author_real_name:
      typeof r.last_reply_author_real_name === "string"
        ? r.last_reply_author_real_name
        : null,
    last_reply_excerpt:
      typeof r.last_reply_excerpt === "string" ? r.last_reply_excerpt : null,
    total_replies: safeNumber(r.total_replies),
    participants: safeArray<string>(r.participants).filter(
      (s) => typeof s === "string",
    ),
  };
}

const INITIAL_VERBS: readonly InitialVerb[] = ["draft", "schedule", "save_draft"];

/**
 * normalizeComposePayload — top-level payload normalizer.
 *
 * Accepts both the flat structuredContent shape AND the relay-pattern
 * `_meta.payload` envelope. Returns either a fully-populated ComposePayload
 * (with error: null) or a ComposeError (with error set).
 */
export function normalizeComposePayload(
  raw: unknown,
): (ComposePayload & { error: null }) | (ComposeError & { error: ComposeError["error"] }) {
  if (!raw || typeof raw !== "object") {
    return { error: "action_not_found" } as ComposeError & { error: ComposeError["error"] };
  }

  // Unwrap relay-pattern envelope.
  const maybeWrapped = raw as Record<string, unknown>;
  const unwrapped: Record<string, unknown> =
    maybeWrapped._meta &&
    typeof maybeWrapped._meta === "object" &&
    (maybeWrapped._meta as Record<string, unknown>).payload
      ? safeObject((maybeWrapped._meta as Record<string, unknown>).payload)
      : maybeWrapped;

  // Structured error path.
  if (typeof unwrapped.error === "string") {
    const errorKind = safeEnum(
      unwrapped.error,
      [
        "action_not_found",
        "action_already_handled",
        "agntux_root_missing",
        "license_paused",
      ] as const,
      "action_not_found",
    );
    return { error: errorKind } as ComposeError & { error: ComposeError["error"] };
  }

  // Success path.
  return {
    error: null,
    action_id: safeString(unwrapped.action_id),
    initial_verb: safeEnum(unwrapped.initial_verb, INITIAL_VERBS, "draft"),
    channel: normalizeChannel(unwrapped.channel),
    thread: normalizeThread(unwrapped.thread),
    messages_preview: safeArray<unknown>(unwrapped.messages_preview).map(
      normalizeMessage,
    ),
    messages_truncated: safeBoolean(unwrapped.messages_truncated),
    drafted_body: safeString(unwrapped.drafted_body),
    personalization_signals: safeArray<string>(
      unwrapped.personalization_signals,
    ).filter((s) => typeof s === "string"),
    proposed_send_time:
      typeof unwrapped.proposed_send_time === "string"
        ? unwrapped.proposed_send_time
        : null,
    slack_permalink:
      typeof unwrapped.slack_permalink === "string"
        ? unwrapped.slack_permalink
        : null,
  } as ComposePayload & { error: null };
}

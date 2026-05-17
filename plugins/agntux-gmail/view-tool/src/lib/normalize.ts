// =============================================================================
// normalize.ts — defensive per-entity normalizers for the gmail compose payload.
//
// Every normalizer follows briefing-learnings §1.2: one normalizer per entity,
// fan out via safeArray().map(normalizeX). All fields have typed defaults so
// undefined never propagates into JSX.
// =============================================================================

import {
  safeArray,
  safeString,
  safeNumber,
  safeObject,
  safeEnum,
} from "@agntux/ui-primitives";
import type {
  ComposePayload,
  ComposeError,
  ThreadInfo,
  Recipients,
  Participant,
} from "./types.js";

// ── Per-entity normalizers ───────────────────────────────────────────────────

export function normalizeParticipant(raw: unknown): Participant {
  const r = safeObject(raw);
  return {
    real_name: safeString(r.real_name),
    email: safeString(r.email),
  };
}

export function normalizeThread(raw: unknown): ThreadInfo {
  const r = safeObject(raw);
  return {
    thread_id: safeString(r.thread_id),
    subject: safeString(r.subject),
    parent_message_id: safeString(r.parent_message_id),
    parent_author_real_name: safeString(r.parent_author_real_name),
    parent_author_email: safeString(r.parent_author_email),
    parent_excerpt: safeString(r.parent_excerpt),
    last_message_id: safeString(r.last_message_id),
    last_author_real_name: safeString(r.last_author_real_name),
    last_author_email: safeString(r.last_author_email),
    last_excerpt: safeString(r.last_excerpt),
    total_messages: safeNumber(r.total_messages),
    participants: safeArray<unknown>(r.participants).map(normalizeParticipant),
  };
}

export function normalizeRecipients(raw: unknown): Recipients {
  const r = safeObject(raw);
  return {
    to: safeArray<string>(r.to).filter((s) => typeof s === "string"),
    cc: safeArray<string>(r.cc).filter((s) => typeof s === "string"),
    bcc: safeArray<string>(r.bcc).filter((s) => typeof s === "string"),
  };
}

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
        "compose_payload_missing",
      ] as const,
      "action_not_found",
    );
    return { error: errorKind } as ComposeError & { error: ComposeError["error"] };
  }

  // Success path.
  return {
    error: null,
    action_id: safeString(unwrapped.action_id),
    thread: normalizeThread(unwrapped.thread),
    recipients: normalizeRecipients(unwrapped.recipients),
    reply_to_message_id: safeString(unwrapped.reply_to_message_id),
    drafted_body: safeString(unwrapped.drafted_body),
    personalization_signals: safeArray<string>(
      unwrapped.personalization_signals,
    ).filter((s) => typeof s === "string"),
    email_context: safeString(unwrapped.email_context),
    gmail_thread_url:
      typeof unwrapped.gmail_thread_url === "string"
        ? unwrapped.gmail_thread_url
        : null,
    user_email:
      typeof unwrapped.user_email === "string" ? unwrapped.user_email : null,
    account_index:
      typeof unwrapped.account_index === "number" &&
      Number.isFinite(unwrapped.account_index)
        ? unwrapped.account_index
        : null,
  } as ComposePayload & { error: null };
}

// =============================================================================
// normalize.ts — defensive per-entity normalizers for the canvas payload.
// =============================================================================

import {
  safeArray,
  safeString,
  safeNumber,
  safeObject,
  safeEnum,
} from "./safe-accessors.js";
import type {
  CanvasPayload,
  CanvasError,
  ChannelInfo,
  ThreadInfo,
  DraftedCanvas,
} from "./types.js";

export function normalizeChannel(raw: unknown): ChannelInfo {
  const r = safeObject(raw);
  return { id: safeString(r.id), name: safeString(r.name) };
}

export function normalizeThread(raw: unknown): ThreadInfo {
  const r = safeObject(raw);
  return {
    parent_ts: safeString(r.parent_ts),
    total_replies: safeNumber(r.total_replies),
    participants: safeArray<string>(r.participants).filter(
      (s) => typeof s === "string",
    ),
  };
}

export function normalizeDraftedCanvas(raw: unknown): DraftedCanvas {
  const r = safeObject(raw);
  return {
    title: safeString(r.title),
    tldr: safeString(r.tldr),
    decisions: safeArray<string>(r.decisions).filter(
      (s) => typeof s === "string",
    ),
    open_questions: safeArray<string>(r.open_questions).filter(
      (s) => typeof s === "string",
    ),
    participants: safeArray<string>(r.participants).filter(
      (s) => typeof s === "string",
    ),
  };
}

/**
 * normalizeCanvasPayload — top-level normalizer.
 * Accepts flat structuredContent or relay-pattern `_meta.payload` envelope.
 */
export function normalizeCanvasPayload(
  raw: unknown,
): (CanvasPayload & { error: null }) | (CanvasError & { error: CanvasError["error"] }) {
  if (!raw || typeof raw !== "object") {
    return { error: "action_not_found" } as CanvasError & { error: CanvasError["error"] };
  }

  const maybeWrapped = raw as Record<string, unknown>;
  const unwrapped: Record<string, unknown> =
    maybeWrapped._meta &&
    typeof maybeWrapped._meta === "object" &&
    (maybeWrapped._meta as Record<string, unknown>).payload
      ? safeObject((maybeWrapped._meta as Record<string, unknown>).payload)
      : maybeWrapped;

  if (typeof unwrapped.error === "string") {
    const errorKind = safeEnum(
      unwrapped.error,
      [
        "action_not_found",
        "action_already_handled",
        "agntux_root_missing",
      ] as const,
      "action_not_found",
    );
    return { error: errorKind } as CanvasError & { error: CanvasError["error"] };
  }

  return {
    error: null,
    action_id: safeString(unwrapped.action_id),
    channel: normalizeChannel(unwrapped.channel),
    thread: normalizeThread(unwrapped.thread),
    drafted_canvas: normalizeDraftedCanvas(unwrapped.drafted_canvas),
    proposed_followup_message: safeString(unwrapped.proposed_followup_message),
  } as CanvasPayload & { error: null };
}

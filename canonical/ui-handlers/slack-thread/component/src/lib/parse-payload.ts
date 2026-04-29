// =============================================================================
// parse-payload.ts — defensive parser for the slack-thread structuredContent
// =============================================================================
//
// Rules (per P9 §2.6 + component-template pattern):
//   - NEVER throws — returns a fully-formed object on any input including
//     null, undefined, malformed objects, or mid-stream partials.
//   - Every field defaults: arrays → [], strings → "", objects → {}.
//   - Handles three envelope shapes uniformly:
//       A) { _meta: { payload: {...} } }  — canonical relay envelope (and the
//                                          synthesized shape during streaming)
//       B) { thread_messages: [...], ... } — flat structuredContent
//       C) {} / undefined / null           — pre-first-partial or empty
// =============================================================================

export interface ThreadMessage {
  id: string;
  ts: string;
  user_id: string;
  text: string;
}

export interface ThreadMember {
  user_id: string;
  name: string;
  real_name: string;
}

export interface SlackThreadPayload {
  thread_messages: ThreadMessage[];
  thread_members: ThreadMember[];
  highlighted_msg_ids: string[];
  proposed_reply: string;
  action_id: string;
  channel_id: string;
  channel_name: string;
  thread_ts: string;
  /** Present only when the view tool returns a structured error. */
  error?: "auth_failed" | "not_found" | "network";
}

const DEFAULT_PAYLOAD: SlackThreadPayload = {
  thread_messages: [],
  thread_members: [],
  highlighted_msg_ids: [],
  proposed_reply: "",
  action_id: "",
  channel_id: "",
  channel_name: "",
  thread_ts: "",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function safeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function parseMessages(raw: unknown): ThreadMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((m) => ({
      id:      safeString(m["id"]),
      ts:      safeString(m["ts"]),
      user_id: safeString(m["user_id"]),
      text:    safeString(m["text"]),
    }));
}

function parseMembers(raw: unknown): ThreadMember[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((m) => ({
      user_id:   safeString(m["user_id"]),
      name:      safeString(m["name"]),
      real_name: safeString(m["real_name"]),
    }));
}

function parseError(v: unknown): "auth_failed" | "not_found" | "network" | undefined {
  if (v === "auth_failed" || v === "not_found" || v === "network") return v;
  return undefined;
}

/**
 * parsePayload — defensive extraction for progressive + final renders.
 *
 * Returns a fully-formed SlackThreadPayload even on null, undefined, or
 * malformed input. No throws, no narrow exception handling.
 *
 * @param toolOutput  The value of `toolOutput` prop from App.tsx — may be
 *                    undefined (pre-first-partial), a relay envelope
 *                    ({ _meta: { payload: {...} } }), or flat structuredContent.
 */
export function parsePayload(toolOutput?: Record<string, unknown> | null): SlackThreadPayload {
  // Safely unwrap — guard against non-object inputs first.
  if (!isRecord(toolOutput)) {
    return { ...DEFAULT_PAYLOAD };
  }

  // Shape A: relay envelope { _meta: { payload: {...} } } — used during streaming.
  const meta = toolOutput["_meta"];
  const payload: Record<string, unknown> = isRecord(meta) && isRecord(meta["payload"])
    ? meta["payload"]
    : toolOutput; // Shape B: flat structuredContent

  return {
    thread_messages:     parseMessages(payload["thread_messages"]),
    thread_members:      parseMembers(payload["thread_members"]),
    highlighted_msg_ids: safeStringArray(payload["highlighted_msg_ids"]),
    proposed_reply:      safeString(payload["proposed_reply"]),
    action_id:           safeString(payload["action_id"]),
    channel_id:          safeString(payload["channel_id"]),
    channel_name:        safeString(payload["channel_name"]),
    thread_ts:           safeString(payload["thread_ts"]),
    error:               parseError(payload["error"]),
  };
}

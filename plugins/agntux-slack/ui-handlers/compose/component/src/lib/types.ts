// =============================================================================
// types.ts — strict TypeScript types matching the compose_view structuredContent
// schema (§2b of the plugin brief).
// =============================================================================

export type InitialVerb = "draft" | "schedule" | "save_draft";

export interface ChannelInfo {
  id: string;
  name: string;
  is_dm: boolean;
}

export interface ThreadInfo {
  parent_ts: string;
  parent_author_real_name: string;
  parent_excerpt: string;
  last_reply_ts: string | null;
  last_reply_author_real_name: string | null;
  last_reply_excerpt: string | null;
  total_replies: number;
  participants: string[];
}

export interface MessagePreview {
  ts: string;
  author: string;
  body_excerpt: string;
}

export interface ComposePayload {
  action_id: string;
  initial_verb: InitialVerb;
  channel: ChannelInfo;
  thread: ThreadInfo;
  messages_preview: MessagePreview[];
  messages_truncated: boolean;
  drafted_body: string;
  personalization_signals: string[];
  proposed_send_time: string | null;
  slack_permalink: string | null;
}

export interface ComposeError {
  error:
    | "action_not_found"
    | "action_already_handled"
    | "agntux_root_missing";
}

export type ComposeData = (ComposePayload & { error: null }) | (ComposeError & { error: ComposeError["error"] });

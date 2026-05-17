// =============================================================================
// types.ts — strict TypeScript types matching the gmail compose_view
// structuredContent schema.
// =============================================================================

export interface Participant {
  real_name: string;
  email: string;
}

export interface ThreadInfo {
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
  participants: Participant[];
}

export interface Recipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

export interface ComposePayload {
  action_id: string;
  thread: ThreadInfo;
  recipients: Recipients;
  reply_to_message_id: string;
  drafted_body: string;
  personalization_signals: string[];
  email_context: string;
  gmail_thread_url: string | null;
  user_email: string | null;
  account_index: number | null;
}

export interface ComposeError {
  error:
    | "action_not_found"
    | "action_already_handled"
    | "agntux_root_missing"
    | "compose_payload_missing";
}

export type ComposeData =
  | (ComposePayload & { error: null })
  | (ComposeError & { error: ComposeError["error"] });

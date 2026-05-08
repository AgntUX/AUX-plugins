// =============================================================================
// types.ts — strict TypeScript types matching the canvas_view structuredContent
// schema (§3b of the plugin brief).
// =============================================================================

export interface ChannelInfo {
  id: string;
  name: string;
}

export interface ThreadInfo {
  parent_ts: string;
  total_replies: number;
  participants: string[];
}

export interface DraftedCanvas {
  title: string;        // ≤80 chars
  tldr: string;         // ≤500 chars
  decisions: string[];  // ≤8 × ≤200 chars
  open_questions: string[]; // ≤8 × ≤200 chars
  participants: string[];   // ≤12 real names
}

export interface CanvasPayload {
  action_id: string;
  channel: ChannelInfo;
  thread: ThreadInfo;
  drafted_canvas: DraftedCanvas;
  proposed_followup_message: string; // ≤200 chars
}

export interface CanvasError {
  error:
    | "action_not_found"
    | "action_already_handled"
    | "agntux_root_missing";
}

export type CanvasData =
  | (CanvasPayload & { error: null })
  | (CanvasError & { error: CanvasError["error"] });

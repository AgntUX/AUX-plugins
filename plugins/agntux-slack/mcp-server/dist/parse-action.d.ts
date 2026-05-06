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
export declare function parseFrontmatter(text: string): {
    frontmatter: ActionFrontmatter;
    body: string;
};
export declare function extractSection(body: string, header: string): string;
export declare function parseBodySection(body: string, header: string): Record<string, unknown> | null;
export declare function parseActionFile(filePath: string): ParsedAction;
//# sourceMappingURL=parse-action.d.ts.map
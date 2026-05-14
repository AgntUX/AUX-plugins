export interface SuggestedActionRow {
    label: string;
    host_prompt: string;
    url: string | null;
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
    updated_at: string | null;
    team_id: string | null;
    team_slug: string | null;
    source_team: string | null;
    member_relevance_class: string | null;
    relevance_classes: string[];
    done_by_user_slug: string | null;
    done_by_user_id: string | null;
    done_at: string | null;
}
export interface ParsedAction {
    frontmatter: ActionFrontmatter;
    why_matters: string;
    personalization_fit: string;
}
/** Shape of a single on-disk action file (frontmatter + body sections). */
export type ActionFile = ParsedAction;
export declare function parseFrontmatter(text: string): {
    frontmatter: ActionFrontmatter;
    body: string;
};
export declare function extractSection(body: string, header: string): string;
/**
 * Parse an action file from a Buffer or string body. Replaces the legacy
 * `parseActionFile(path)` from agntux-core/mcp-server — the caller is now
 * responsible for the fs read (typically `await ctx.fs.readFile(...)`).
 */
export declare function parseActionFile(content: string | Buffer): ParsedAction;

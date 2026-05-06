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
}
export interface ParsedAction {
    frontmatter: ActionFrontmatter;
    why_matters: string;
    personalization_fit: string;
}
export declare function parseFrontmatter(text: string): {
    frontmatter: ActionFrontmatter;
    body: string;
};
export declare function extractSection(body: string, header: string): string;
export declare function parseActionFile(filePath: string): ParsedAction;
//# sourceMappingURL=parse-action.d.ts.map
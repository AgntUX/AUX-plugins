import { type SuggestedActionRow } from "../parse-action.js";
declare const TRIAGE_RESOURCE_URI = "ui://triage";
interface TriageActionRow {
    id: string;
    title: string;
    summary: string;
    priority: "high" | "medium" | "low";
    status: "open" | "snoozed";
    reason_class: string;
    due_by: string | null;
    snoozed_until: string | null;
    source: string | null;
    related_entities: string[];
    suggested_actions: SuggestedActionRow[];
    why_matters_excerpt: string;
    personalization_fit_excerpt: string;
    created_at: string | null;
    updated_at: string | null;
}
interface TriageHandledRow {
    id: string;
    title: string;
    priority: "high" | "medium" | "low";
    status: "done" | "dismissed";
    handled_at: string;
    outcome: string | null;
}
interface TriageCounts {
    open: number;
    snoozed: number;
    handled_recent: number;
    truncated: boolean;
}
interface TriageStructuredContent {
    actions: TriageActionRow[];
    handled_recent: TriageHandledRow[];
    counts: TriageCounts;
    last_updated_at: string;
    bootstrap_mode: boolean;
}
interface TriageStructuredError {
    error: "actions_index_missing" | "license_paused";
}
interface ViewToolSuccess {
    structuredContent: TriageStructuredContent;
    content: Array<{
        type: "text";
        text: string;
    }>;
    _meta: {
        ui: {
            resourceUri: typeof TRIAGE_RESOURCE_URI;
            visibility: ["model", "app"];
        };
    };
}
interface ViewToolError {
    structuredContent: TriageStructuredError;
    content: Array<{
        type: "text";
        text: string;
    }>;
    _meta: {
        ui: {
            resourceUri: typeof TRIAGE_RESOURCE_URI;
            visibility: ["model", "app"];
        };
    };
}
type ViewToolResult = ViewToolSuccess | ViewToolError;
export declare const triageViewTool: {
    readonly name: "agntux_core_triage_view";
    readonly description: string;
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly view_handled_days: {
                readonly type: "number";
                readonly description: "Optional. Time window for handled-recent items, in days. Default 7, max 30.";
            };
            readonly limit: {
                readonly type: "number";
                readonly description: "Optional. Cap on the open-actions list. Default 30, max 50.";
            };
        };
        readonly required: readonly [];
    };
    readonly _meta: {
        readonly ui: {
            readonly resourceUri: "ui://triage";
        };
    };
};
export declare function handleTriageView(args: Record<string, unknown>): Promise<ViewToolResult>;
export {};

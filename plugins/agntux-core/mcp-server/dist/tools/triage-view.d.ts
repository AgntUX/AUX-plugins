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
interface ViewToolMeta {
    ui: {
        resourceUri: typeof TRIAGE_RESOURCE_URI;
    };
}
interface ViewToolSuccess {
    structuredContent: TriageStructuredContent;
    content: Array<{
        type: "text";
        text: string;
    }>;
    _meta: ViewToolMeta;
}
interface ViewToolError {
    structuredContent: TriageStructuredError;
    content: Array<{
        type: "text";
        text: string;
    }>;
    _meta: ViewToolMeta;
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
    readonly outputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly actions: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly properties: {
                        readonly id: {
                            readonly type: "string";
                        };
                        readonly title: {
                            readonly type: "string";
                        };
                        readonly summary: {
                            readonly type: "string";
                        };
                        readonly priority: {
                            readonly type: "string";
                        };
                        readonly status: {
                            readonly type: "string";
                        };
                        readonly reason_class: {
                            readonly type: "string";
                        };
                        readonly due_by: {};
                        readonly snoozed_until: {};
                        readonly source: {};
                        readonly related_entities: {
                            readonly type: "array";
                            readonly items: {
                                readonly type: "string";
                            };
                        };
                        readonly suggested_actions: {
                            readonly type: "array";
                        };
                        readonly why_matters_excerpt: {
                            readonly type: "string";
                        };
                        readonly personalization_fit_excerpt: {
                            readonly type: "string";
                        };
                        readonly created_at: {};
                        readonly updated_at: {};
                    };
                };
            };
            readonly handled_recent: {
                readonly type: "array";
            };
            readonly counts: {
                readonly type: "object";
                readonly properties: {
                    readonly open: {
                        readonly type: "number";
                    };
                    readonly snoozed: {
                        readonly type: "number";
                    };
                    readonly handled_recent: {
                        readonly type: "number";
                    };
                    readonly truncated: {
                        readonly type: "boolean";
                    };
                };
            };
            readonly last_updated_at: {
                readonly type: "string";
            };
            readonly bootstrap_mode: {
                readonly type: "boolean";
            };
            readonly error: {
                readonly type: "string";
            };
        };
    };
    readonly _meta: {
        readonly ui: {
            readonly resourceUri: "ui://triage";
        };
        readonly "ui/resourceUri": "ui://triage";
    };
};
export declare function handleTriageView(args: Record<string, unknown>): Promise<ViewToolResult>;
export {};

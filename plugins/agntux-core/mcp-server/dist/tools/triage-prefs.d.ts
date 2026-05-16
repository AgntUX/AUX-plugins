export interface TriagePrefsV2 {
    schema_version: 2;
    muted_team_slugs: string[];
    muted_view_slugs: string[];
    team_filters: Record<string, "shown" | "hidden">;
    view_filters: Record<string, "shown" | "hidden">;
    relevance_class_filters: Record<string, string[]>;
    sort: string;
    show_done: boolean;
    show_snoozed: boolean;
    show_dismissed: boolean;
    triage_state: Record<string, {
        snoozed_until: string | null;
        dismissed_at: string | null;
    }>;
}
export declare function readTriagePrefs(): TriagePrefsV2;
export declare const triagePrefsTool: {
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            muted_team_slugs: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            muted_view_slugs: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            team_filters: {
                type: string;
                description: string;
            };
            view_filters: {
                type: string;
                description: string;
            };
            relevance_class_filters: {
                type: string;
                description: string;
            };
            sort: {
                type: string;
                description: string;
            };
            show_done: {
                type: string;
                description: string;
            };
            show_snoozed: {
                type: string;
                description: string;
            };
            show_dismissed: {
                type: string;
                description: string;
            };
        };
        required: never[];
    };
    handler(args: Record<string, unknown>): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
};
export declare const setTriagePrefTool: {
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            path: {
                type: string;
                description: string;
            };
            snoozed_until: {
                description: string;
            };
            dismissed_at: {
                description: string;
            };
        };
        required: string[];
    };
    handler(args: Record<string, unknown>): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
};

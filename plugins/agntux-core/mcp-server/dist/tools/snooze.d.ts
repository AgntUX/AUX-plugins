export declare const snoozeTool: {
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            team_slug: {
                readonly type: "string";
                readonly description: "Optional. Route the write to `<root>/teams/{team_slug}/actions/` instead of personal. Mutually exclusive with view_slug. Omit (solo path) for personal items.";
            };
            view_slug: {
                readonly type: "string";
                readonly description: "Optional. Route the write to `<root>/leader-views/{view_slug}/actions/` instead of personal. Mutually exclusive with team_slug. Omit for personal items.";
            };
            id: {
                type: string;
                description: string;
            };
            until: {
                type: string;
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

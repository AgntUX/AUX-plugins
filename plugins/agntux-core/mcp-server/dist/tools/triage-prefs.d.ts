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

export declare const dismissTool: {
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            id: {
                type: string;
                description: string;
            };
            outcome: {
                type: string;
                description: string;
            };
            outcome_note: {
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
//# sourceMappingURL=dismiss.d.ts.map
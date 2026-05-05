export declare const pivotTool: {
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            subtype: {
                type: string;
                description: string;
            };
            slug: {
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
        _meta: {
            host_prompt: string;
            entity: {
                subtype: string;
                slug: string;
            };
        };
    }>;
};
//# sourceMappingURL=pivot.d.ts.map
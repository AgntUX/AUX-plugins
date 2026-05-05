export declare function appendOutcomeSection(file: string, outcome: string, note?: string): string;
export declare const setStatusTool: {
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            id: {
                type: string;
                description: string;
            };
            status: {
                type: string;
                enum: string[];
                description: string;
            };
            snoozed_until: {
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
//# sourceMappingURL=set-status.d.ts.map
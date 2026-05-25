export declare const createProjectDirectoryTool: {
    description: string;
    inputSchema: {
        type: "object";
        properties: {};
        required: never[];
        additionalProperties: boolean;
    };
    handler(_args: Record<string, unknown>): Promise<{
        isError: boolean;
        content: {
            type: "text";
            text: string;
        }[];
        structuredContent: {
            ok: boolean;
            path: string;
            created: boolean;
            error: string;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        structuredContent: {
            ok: boolean;
            path: string;
            created: boolean;
        };
    }>;
};

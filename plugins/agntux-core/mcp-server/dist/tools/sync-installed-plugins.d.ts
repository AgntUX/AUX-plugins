export interface InstalledPluginEntry {
    slug: string;
    marketplace: string;
    version?: string;
    source_sha?: string;
}
export interface InstalledPluginsFile {
    schema_version: 1;
    generated_at: string;
    plugins: InstalledPluginEntry[];
}
export declare const syncInstalledPluginsTool: {
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            plugins: {
                type: string;
                description: string;
                items: {
                    type: string;
                    properties: {
                        slug: {
                            type: string;
                        };
                        marketplace: {
                            type: string;
                        };
                        version: {
                            type: string;
                        };
                        source_sha: {
                            type: string;
                        };
                    };
                    required: string[];
                };
            };
        };
        required: string[];
    };
    handler(args: Record<string, unknown>): Promise<{
        isError: boolean;
        content: {
            type: "text";
            text: string;
        }[];
        structuredContent: {
            ok: boolean;
            written: boolean;
            valid: number;
            received?: undefined;
            dropped_count?: undefined;
            dropped?: undefined;
        };
    } | {
        isError: boolean;
        content: {
            type: "text";
            text: string;
        }[];
        structuredContent: {
            ok: boolean;
            written: boolean;
            received: number;
            valid: number;
            dropped_count: number;
            dropped: string[];
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        structuredContent: {
            dropped_count?: number | undefined;
            dropped?: string[] | undefined;
            ok: boolean;
            written: boolean;
            path: string;
            plugin_count: number;
            valid?: undefined;
            received?: undefined;
        };
        isError?: undefined;
    }>;
};

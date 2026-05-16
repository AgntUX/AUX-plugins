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
        content: {
            type: "text";
            text: string;
        }[];
        structuredContent: {
            ok: boolean;
            path: string;
            plugin_count: number;
        };
    }>;
};

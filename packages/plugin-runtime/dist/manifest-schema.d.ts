import { z } from "zod";
export declare const ScopeSchema: z.ZodEnum<["personal", "team", "leader-view"]>;
export type Scope = z.infer<typeof ScopeSchema>;
export declare const DataPathSchema: z.ZodObject<{
    pattern: z.ZodString;
    scope: z.ZodEnum<["personal", "team", "leader-view"]>;
}, "strip", z.ZodTypeAny, {
    pattern: string;
    scope: "personal" | "team" | "leader-view";
}, {
    pattern: string;
    scope: "personal" | "team" | "leader-view";
}>;
export declare const UiResourceUriRegex: RegExp;
export declare const McpAppMetaSchema: z.ZodObject<{
    resourceUri: z.ZodString;
    csp: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    permissions: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    resourceUri: string;
    csp: Record<string, unknown>;
    permissions: Record<string, unknown>;
}, {
    resourceUri: string;
    csp: Record<string, unknown>;
    permissions: Record<string, unknown>;
}>;
export declare const ViewToolSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    outputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    mcp_app_meta: z.ZodObject<{
        resourceUri: z.ZodString;
        csp: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        permissions: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        resourceUri: string;
        csp: Record<string, unknown>;
        permissions: Record<string, unknown>;
    }, {
        resourceUri: string;
        csp: Record<string, unknown>;
        permissions: Record<string, unknown>;
    }>;
    data_paths: z.ZodArray<z.ZodObject<{
        pattern: z.ZodString;
        scope: z.ZodEnum<["personal", "team", "leader-view"]>;
    }, "strip", z.ZodTypeAny, {
        pattern: string;
        scope: "personal" | "team" | "leader-view";
    }, {
        pattern: string;
        scope: "personal" | "team" | "leader-view";
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    mcp_app_meta: {
        resourceUri: string;
        csp: Record<string, unknown>;
        permissions: Record<string, unknown>;
    };
    data_paths: {
        pattern: string;
        scope: "personal" | "team" | "leader-view";
    }[];
}, {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    mcp_app_meta: {
        resourceUri: string;
        csp: Record<string, unknown>;
        permissions: Record<string, unknown>;
    };
    data_paths: {
        pattern: string;
        scope: "personal" | "team" | "leader-view";
    }[];
}>;
export declare const HandlerModuleRegex: RegExp;
export declare const HtmlPathRegex: RegExp;
export declare const UiBundleSchema: z.ZodObject<{
    uri: z.ZodString;
    html_path: z.ZodString;
    csp: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    permissions: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    csp: Record<string, unknown>;
    permissions: Record<string, unknown>;
    uri: string;
    html_path: string;
}, {
    csp: Record<string, unknown>;
    permissions: Record<string, unknown>;
    uri: string;
    html_path: string;
}>;
export declare const ViewToolsManifestSchema: z.ZodEffects<z.ZodObject<{
    plugin_slug: z.ZodString;
    plugin_version: z.ZodString;
    handler_module: z.ZodString;
    view_tools: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        outputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        mcp_app_meta: z.ZodObject<{
            resourceUri: z.ZodString;
            csp: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            permissions: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            resourceUri: string;
            csp: Record<string, unknown>;
            permissions: Record<string, unknown>;
        }, {
            resourceUri: string;
            csp: Record<string, unknown>;
            permissions: Record<string, unknown>;
        }>;
        data_paths: z.ZodArray<z.ZodObject<{
            pattern: z.ZodString;
            scope: z.ZodEnum<["personal", "team", "leader-view"]>;
        }, "strip", z.ZodTypeAny, {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }, {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        outputSchema: Record<string, unknown>;
        mcp_app_meta: {
            resourceUri: string;
            csp: Record<string, unknown>;
            permissions: Record<string, unknown>;
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }, {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        outputSchema: Record<string, unknown>;
        mcp_app_meta: {
            resourceUri: string;
            csp: Record<string, unknown>;
            permissions: Record<string, unknown>;
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }>, "many">;
    ui_bundles: z.ZodArray<z.ZodObject<{
        uri: z.ZodString;
        html_path: z.ZodString;
        csp: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        permissions: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        csp: Record<string, unknown>;
        permissions: Record<string, unknown>;
        uri: string;
        html_path: string;
    }, {
        csp: Record<string, unknown>;
        permissions: Record<string, unknown>;
        uri: string;
        html_path: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    plugin_slug: string;
    plugin_version: string;
    handler_module: string;
    view_tools: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        outputSchema: Record<string, unknown>;
        mcp_app_meta: {
            resourceUri: string;
            csp: Record<string, unknown>;
            permissions: Record<string, unknown>;
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }[];
    ui_bundles: {
        csp: Record<string, unknown>;
        permissions: Record<string, unknown>;
        uri: string;
        html_path: string;
    }[];
}, {
    plugin_slug: string;
    plugin_version: string;
    handler_module: string;
    view_tools: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        outputSchema: Record<string, unknown>;
        mcp_app_meta: {
            resourceUri: string;
            csp: Record<string, unknown>;
            permissions: Record<string, unknown>;
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }[];
    ui_bundles: {
        csp: Record<string, unknown>;
        permissions: Record<string, unknown>;
        uri: string;
        html_path: string;
    }[];
}>, {
    plugin_slug: string;
    plugin_version: string;
    handler_module: string;
    view_tools: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        outputSchema: Record<string, unknown>;
        mcp_app_meta: {
            resourceUri: string;
            csp: Record<string, unknown>;
            permissions: Record<string, unknown>;
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }[];
    ui_bundles: {
        csp: Record<string, unknown>;
        permissions: Record<string, unknown>;
        uri: string;
        html_path: string;
    }[];
}, {
    plugin_slug: string;
    plugin_version: string;
    handler_module: string;
    view_tools: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        outputSchema: Record<string, unknown>;
        mcp_app_meta: {
            resourceUri: string;
            csp: Record<string, unknown>;
            permissions: Record<string, unknown>;
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }[];
    ui_bundles: {
        csp: Record<string, unknown>;
        permissions: Record<string, unknown>;
        uri: string;
        html_path: string;
    }[];
}>;
export type ViewToolsManifest = z.infer<typeof ViewToolsManifestSchema>;
export type DataPath = z.infer<typeof DataPathSchema>;
export type McpAppMeta = z.infer<typeof McpAppMetaSchema>;
export type ViewToolEntry = z.infer<typeof ViewToolSchema>;
export type UiBundleEntry = z.infer<typeof UiBundleSchema>;

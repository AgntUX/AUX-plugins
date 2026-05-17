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
export declare const McpUiCspSchema: z.ZodObject<{
    connectDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    resourceDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    frameDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    baseUriDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strict", z.ZodTypeAny, {
    connectDomains?: string[] | undefined;
    resourceDomains?: string[] | undefined;
    frameDomains?: string[] | undefined;
    baseUriDomains?: string[] | undefined;
}, {
    connectDomains?: string[] | undefined;
    resourceDomains?: string[] | undefined;
    frameDomains?: string[] | undefined;
    baseUriDomains?: string[] | undefined;
}>;
export declare const McpUiPermissionsSchema: z.ZodObject<{
    camera: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
    microphone: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
    geolocation: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
    clipboardWrite: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
}, "strict", z.ZodTypeAny, {
    camera?: {} | undefined;
    microphone?: {} | undefined;
    geolocation?: {} | undefined;
    clipboardWrite?: {} | undefined;
}, {
    camera?: {} | undefined;
    microphone?: {} | undefined;
    geolocation?: {} | undefined;
    clipboardWrite?: {} | undefined;
}>;
export declare const McpAppMetaSchema: z.ZodObject<{
    resourceUri: z.ZodString;
    csp: z.ZodObject<{
        connectDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        resourceDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        frameDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        baseUriDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        connectDomains?: string[] | undefined;
        resourceDomains?: string[] | undefined;
        frameDomains?: string[] | undefined;
        baseUriDomains?: string[] | undefined;
    }, {
        connectDomains?: string[] | undefined;
        resourceDomains?: string[] | undefined;
        frameDomains?: string[] | undefined;
        baseUriDomains?: string[] | undefined;
    }>;
    permissions: z.ZodObject<{
        camera: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
        microphone: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
        geolocation: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
        clipboardWrite: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
    }, "strict", z.ZodTypeAny, {
        camera?: {} | undefined;
        microphone?: {} | undefined;
        geolocation?: {} | undefined;
        clipboardWrite?: {} | undefined;
    }, {
        camera?: {} | undefined;
        microphone?: {} | undefined;
        geolocation?: {} | undefined;
        clipboardWrite?: {} | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    resourceUri: string;
    csp: {
        connectDomains?: string[] | undefined;
        resourceDomains?: string[] | undefined;
        frameDomains?: string[] | undefined;
        baseUriDomains?: string[] | undefined;
    };
    permissions: {
        camera?: {} | undefined;
        microphone?: {} | undefined;
        geolocation?: {} | undefined;
        clipboardWrite?: {} | undefined;
    };
}, {
    resourceUri: string;
    csp: {
        connectDomains?: string[] | undefined;
        resourceDomains?: string[] | undefined;
        frameDomains?: string[] | undefined;
        baseUriDomains?: string[] | undefined;
    };
    permissions: {
        camera?: {} | undefined;
        microphone?: {} | undefined;
        geolocation?: {} | undefined;
        clipboardWrite?: {} | undefined;
    };
}>;
export declare const ViewToolSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    outputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    mcp_app_meta: z.ZodObject<{
        resourceUri: z.ZodString;
        csp: z.ZodObject<{
            connectDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            resourceDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            frameDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            baseUriDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strict", z.ZodTypeAny, {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        }, {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        }>;
        permissions: z.ZodObject<{
            camera: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
            microphone: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
            geolocation: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
            clipboardWrite: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
        }, "strict", z.ZodTypeAny, {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        }, {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        resourceUri: string;
        csp: {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        };
        permissions: {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        };
    }, {
        resourceUri: string;
        csp: {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        };
        permissions: {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        };
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
        csp: {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        };
        permissions: {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        };
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
        csp: {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        };
        permissions: {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        };
    };
    data_paths: {
        pattern: string;
        scope: "personal" | "team" | "leader-view";
    }[];
}>;
export declare const NoParentSegment: RegExp;
export declare const HandlerModuleRegex: RegExp;
export declare const HtmlPathRegex: RegExp;
export declare const HandlerModulePath: z.ZodEffects<z.ZodString, string, string>;
export declare const HtmlPath: z.ZodEffects<z.ZodString, string, string>;
export declare const UiBundleSchema: z.ZodObject<{
    uri: z.ZodString;
    html_path: z.ZodEffects<z.ZodString, string, string>;
    csp: z.ZodObject<{
        connectDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        resourceDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        frameDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        baseUriDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        connectDomains?: string[] | undefined;
        resourceDomains?: string[] | undefined;
        frameDomains?: string[] | undefined;
        baseUriDomains?: string[] | undefined;
    }, {
        connectDomains?: string[] | undefined;
        resourceDomains?: string[] | undefined;
        frameDomains?: string[] | undefined;
        baseUriDomains?: string[] | undefined;
    }>;
    permissions: z.ZodObject<{
        camera: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
        microphone: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
        geolocation: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
        clipboardWrite: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
    }, "strict", z.ZodTypeAny, {
        camera?: {} | undefined;
        microphone?: {} | undefined;
        geolocation?: {} | undefined;
        clipboardWrite?: {} | undefined;
    }, {
        camera?: {} | undefined;
        microphone?: {} | undefined;
        geolocation?: {} | undefined;
        clipboardWrite?: {} | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    csp: {
        connectDomains?: string[] | undefined;
        resourceDomains?: string[] | undefined;
        frameDomains?: string[] | undefined;
        baseUriDomains?: string[] | undefined;
    };
    permissions: {
        camera?: {} | undefined;
        microphone?: {} | undefined;
        geolocation?: {} | undefined;
        clipboardWrite?: {} | undefined;
    };
    uri: string;
    html_path: string;
}, {
    csp: {
        connectDomains?: string[] | undefined;
        resourceDomains?: string[] | undefined;
        frameDomains?: string[] | undefined;
        baseUriDomains?: string[] | undefined;
    };
    permissions: {
        camera?: {} | undefined;
        microphone?: {} | undefined;
        geolocation?: {} | undefined;
        clipboardWrite?: {} | undefined;
    };
    uri: string;
    html_path: string;
}>;
export declare const ViewToolsManifestSchema: z.ZodEffects<z.ZodObject<{
    plugin_slug: z.ZodString;
    plugin_version: z.ZodString;
    handler_module: z.ZodEffects<z.ZodString, string, string>;
    view_tools: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        outputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        mcp_app_meta: z.ZodObject<{
            resourceUri: z.ZodString;
            csp: z.ZodObject<{
                connectDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                resourceDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                frameDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                baseUriDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            }, "strict", z.ZodTypeAny, {
                connectDomains?: string[] | undefined;
                resourceDomains?: string[] | undefined;
                frameDomains?: string[] | undefined;
                baseUriDomains?: string[] | undefined;
            }, {
                connectDomains?: string[] | undefined;
                resourceDomains?: string[] | undefined;
                frameDomains?: string[] | undefined;
                baseUriDomains?: string[] | undefined;
            }>;
            permissions: z.ZodObject<{
                camera: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
                microphone: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
                geolocation: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
                clipboardWrite: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
            }, "strict", z.ZodTypeAny, {
                camera?: {} | undefined;
                microphone?: {} | undefined;
                geolocation?: {} | undefined;
                clipboardWrite?: {} | undefined;
            }, {
                camera?: {} | undefined;
                microphone?: {} | undefined;
                geolocation?: {} | undefined;
                clipboardWrite?: {} | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            resourceUri: string;
            csp: {
                connectDomains?: string[] | undefined;
                resourceDomains?: string[] | undefined;
                frameDomains?: string[] | undefined;
                baseUriDomains?: string[] | undefined;
            };
            permissions: {
                camera?: {} | undefined;
                microphone?: {} | undefined;
                geolocation?: {} | undefined;
                clipboardWrite?: {} | undefined;
            };
        }, {
            resourceUri: string;
            csp: {
                connectDomains?: string[] | undefined;
                resourceDomains?: string[] | undefined;
                frameDomains?: string[] | undefined;
                baseUriDomains?: string[] | undefined;
            };
            permissions: {
                camera?: {} | undefined;
                microphone?: {} | undefined;
                geolocation?: {} | undefined;
                clipboardWrite?: {} | undefined;
            };
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
            csp: {
                connectDomains?: string[] | undefined;
                resourceDomains?: string[] | undefined;
                frameDomains?: string[] | undefined;
                baseUriDomains?: string[] | undefined;
            };
            permissions: {
                camera?: {} | undefined;
                microphone?: {} | undefined;
                geolocation?: {} | undefined;
                clipboardWrite?: {} | undefined;
            };
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
            csp: {
                connectDomains?: string[] | undefined;
                resourceDomains?: string[] | undefined;
                frameDomains?: string[] | undefined;
                baseUriDomains?: string[] | undefined;
            };
            permissions: {
                camera?: {} | undefined;
                microphone?: {} | undefined;
                geolocation?: {} | undefined;
                clipboardWrite?: {} | undefined;
            };
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }>, "many">;
    ui_bundles: z.ZodArray<z.ZodObject<{
        uri: z.ZodString;
        html_path: z.ZodEffects<z.ZodString, string, string>;
        csp: z.ZodObject<{
            connectDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            resourceDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            frameDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            baseUriDomains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strict", z.ZodTypeAny, {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        }, {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        }>;
        permissions: z.ZodObject<{
            camera: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
            microphone: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
            geolocation: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
            clipboardWrite: z.ZodOptional<z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>>;
        }, "strict", z.ZodTypeAny, {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        }, {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        csp: {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        };
        permissions: {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        };
        uri: string;
        html_path: string;
    }, {
        csp: {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        };
        permissions: {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        };
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
            csp: {
                connectDomains?: string[] | undefined;
                resourceDomains?: string[] | undefined;
                frameDomains?: string[] | undefined;
                baseUriDomains?: string[] | undefined;
            };
            permissions: {
                camera?: {} | undefined;
                microphone?: {} | undefined;
                geolocation?: {} | undefined;
                clipboardWrite?: {} | undefined;
            };
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }[];
    ui_bundles: {
        csp: {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        };
        permissions: {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        };
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
            csp: {
                connectDomains?: string[] | undefined;
                resourceDomains?: string[] | undefined;
                frameDomains?: string[] | undefined;
                baseUriDomains?: string[] | undefined;
            };
            permissions: {
                camera?: {} | undefined;
                microphone?: {} | undefined;
                geolocation?: {} | undefined;
                clipboardWrite?: {} | undefined;
            };
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }[];
    ui_bundles: {
        csp: {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        };
        permissions: {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        };
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
            csp: {
                connectDomains?: string[] | undefined;
                resourceDomains?: string[] | undefined;
                frameDomains?: string[] | undefined;
                baseUriDomains?: string[] | undefined;
            };
            permissions: {
                camera?: {} | undefined;
                microphone?: {} | undefined;
                geolocation?: {} | undefined;
                clipboardWrite?: {} | undefined;
            };
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }[];
    ui_bundles: {
        csp: {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        };
        permissions: {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        };
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
            csp: {
                connectDomains?: string[] | undefined;
                resourceDomains?: string[] | undefined;
                frameDomains?: string[] | undefined;
                baseUriDomains?: string[] | undefined;
            };
            permissions: {
                camera?: {} | undefined;
                microphone?: {} | undefined;
                geolocation?: {} | undefined;
                clipboardWrite?: {} | undefined;
            };
        };
        data_paths: {
            pattern: string;
            scope: "personal" | "team" | "leader-view";
        }[];
    }[];
    ui_bundles: {
        csp: {
            connectDomains?: string[] | undefined;
            resourceDomains?: string[] | undefined;
            frameDomains?: string[] | undefined;
            baseUriDomains?: string[] | undefined;
        };
        permissions: {
            camera?: {} | undefined;
            microphone?: {} | undefined;
            geolocation?: {} | undefined;
            clipboardWrite?: {} | undefined;
        };
        uri: string;
        html_path: string;
    }[];
}>;
export type ViewToolsManifest = z.infer<typeof ViewToolsManifestSchema>;
export type DataPath = z.infer<typeof DataPathSchema>;
export type McpAppMeta = z.infer<typeof McpAppMetaSchema>;
export type McpUiCsp = z.infer<typeof McpUiCspSchema>;
export type McpUiPermissions = z.infer<typeof McpUiPermissionsSchema>;
export type ViewToolEntry = z.infer<typeof ViewToolSchema>;
export type UiBundleEntry = z.infer<typeof UiBundleSchema>;

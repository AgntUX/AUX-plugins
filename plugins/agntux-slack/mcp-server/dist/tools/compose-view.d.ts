declare const COMPOSE_RESOURCE_URI: "ui://slack-compose";
type InitialVerb = "draft" | "schedule" | "save_draft";
interface ChannelInfo {
    id: string;
    name: string;
    is_dm: boolean;
}
interface ThreadInfo {
    parent_ts: string;
    parent_author_real_name: string;
    parent_excerpt: string;
    last_reply_ts: string | null;
    last_reply_author_real_name: string | null;
    last_reply_excerpt: string | null;
    total_replies: number;
    participants: string[];
}
interface MessagePreview {
    ts: string;
    author: string;
    body_excerpt: string;
}
interface ComposeStructuredContent {
    action_id: string;
    initial_verb: InitialVerb;
    channel: ChannelInfo;
    thread: ThreadInfo;
    messages_preview: MessagePreview[];
    messages_truncated: boolean;
    drafted_body: string;
    personalization_signals: string[];
    proposed_send_time: string | null;
    slack_permalink: string | null;
}
interface ComposeStructuredError {
    error: "action_not_found" | "action_already_handled" | "agntux_root_missing" | "license_paused" | "compose_payload_missing";
}
interface ViewToolMeta {
    ui: {
        resourceUri: typeof COMPOSE_RESOURCE_URI;
        visibility: ["model", "app"];
    };
}
interface ViewToolSuccess {
    structuredContent: ComposeStructuredContent;
    content: Array<{
        type: "text";
        text: string;
    }>;
    _meta: ViewToolMeta;
}
interface ViewToolError {
    structuredContent: ComposeStructuredError;
    content: Array<{
        type: "text";
        text: string;
    }>;
    _meta: ViewToolMeta;
}
type ViewToolResult = ViewToolSuccess | ViewToolError;
export declare const composeViewTool: {
    readonly name: "agntux_slack_compose_view";
    readonly description: string;
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly action_id: {
                readonly type: "string";
                readonly description: "Slug of the action item (from filename, no .md suffix).";
            };
            readonly initial_verb: {
                readonly type: "string";
                readonly enum: readonly ["draft", "schedule", "save_draft"];
                readonly description: string;
            };
            readonly drafted_body: {
                readonly type: "string";
                readonly description: string;
            };
            readonly personalization_signals: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly description: string;
            };
            readonly thread_context: {
                readonly type: "object";
                readonly description: string;
                readonly properties: {
                    readonly parent_ts: {
                        readonly type: "string";
                    };
                    readonly parent_author_real_name: {
                        readonly type: "string";
                    };
                    readonly parent_excerpt: {
                        readonly type: "string";
                    };
                    readonly last_reply_ts: {
                        readonly type: "string";
                    };
                    readonly last_reply_author_real_name: {
                        readonly type: "string";
                    };
                    readonly last_reply_excerpt: {
                        readonly type: "string";
                    };
                    readonly total_replies: {
                        readonly type: "number";
                    };
                    readonly participants: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly messages_preview: {
                        readonly type: "array";
                    };
                };
            };
            readonly channel: {
                readonly type: "object";
                readonly description: string;
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                    };
                    readonly name: {
                        readonly type: "string";
                    };
                    readonly is_dm: {
                        readonly type: "boolean";
                    };
                };
            };
            readonly proposed_send_time: {
                readonly type: "string";
                readonly description: string;
            };
            readonly slack_permalink: {
                readonly type: "string";
                readonly description: string;
            };
        };
        readonly required: readonly ["action_id"];
    };
    readonly _meta: {
        readonly ui: {
            readonly resourceUri: "ui://slack-compose";
        };
    };
};
export declare function handleComposeView(args: Record<string, unknown>): Promise<ViewToolResult>;
export {};
//# sourceMappingURL=compose-view.d.ts.map
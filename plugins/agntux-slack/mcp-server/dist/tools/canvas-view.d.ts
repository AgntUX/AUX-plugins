declare const CANVAS_RESOURCE_URI: "ui://slack-canvas";
interface ChannelInfo {
    id: string;
    name: string;
}
interface ThreadInfo {
    parent_ts: string;
    total_replies: number;
    participants: string[];
}
interface DraftedCanvas {
    title: string;
    tldr: string;
    decisions: string[];
    open_questions: string[];
    participants: string[];
}
interface CanvasStructuredContent {
    action_id: string;
    channel: ChannelInfo;
    thread: ThreadInfo;
    drafted_canvas: DraftedCanvas;
    proposed_followup_message: string;
}
interface CanvasStructuredError {
    error: "action_not_found" | "action_already_handled" | "agntux_root_missing" | "license_paused";
}
interface ViewToolMeta {
    ui: {
        resourceUri: typeof CANVAS_RESOURCE_URI;
        visibility: ["model", "app"];
    };
}
interface ViewToolSuccess {
    structuredContent: CanvasStructuredContent;
    content: Array<{
        type: "text";
        text: string;
    }>;
    _meta: ViewToolMeta;
}
interface ViewToolError {
    structuredContent: CanvasStructuredError;
    content: Array<{
        type: "text";
        text: string;
    }>;
    _meta: ViewToolMeta;
}
type ViewToolResult = ViewToolSuccess | ViewToolError;
export declare const canvasViewTool: {
    readonly name: "canvas_view";
    readonly description: string;
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly action_id: {
                readonly type: "string";
                readonly description: "Slug of the action item (from filename, no .md suffix).";
            };
            readonly drafted_canvas: {
                readonly type: "object";
                readonly description: "Required. { title (≤80 chars), tldr (≤500 chars), decisions[] (≤8×200), open_questions[] (≤8×200), participants[] (≤12) }.";
                readonly properties: {
                    readonly title: {
                        readonly type: "string";
                    };
                    readonly tldr: {
                        readonly type: "string";
                    };
                    readonly decisions: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly open_questions: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly participants: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                };
            };
            readonly channel: {
                readonly type: "object";
                readonly description: "Required. { id: string, name: string }.";
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                    };
                    readonly name: {
                        readonly type: "string";
                    };
                };
            };
            readonly thread: {
                readonly type: "object";
                readonly description: "Required. { parent_ts: string, total_replies: number, participants: string[] }.";
                readonly properties: {
                    readonly parent_ts: {
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
                };
            };
            readonly proposed_followup_message: {
                readonly type: "string";
                readonly description: "Required. ≤200 chars. The reply body to post in the thread after canvas creation, e.g. 'Posted a thread summary: {url}'.";
            };
        };
        readonly required: readonly ["action_id", "drafted_canvas", "channel", "thread", "proposed_followup_message"];
    };
    readonly _meta: {
        readonly ui: {
            readonly resourceUri: "ui://slack-canvas";
        };
    };
};
export declare function handleCanvasView(args: Record<string, unknown>): Promise<ViewToolResult>;
export {};
//# sourceMappingURL=canvas-view.d.ts.map
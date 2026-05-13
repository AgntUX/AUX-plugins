export interface ActionScope {
    team_slug?: string;
    view_slug?: string;
}
export declare function resolveActionsDir(scope: ActionScope | undefined): string;
export declare function resolveActionPath(id: string, scope: ActionScope | undefined): string;
export declare const SCOPE_INPUT_SCHEMA_FRAGMENT: {
    readonly team_slug: {
        readonly type: "string";
        readonly description: "Optional. Route the write to `<root>/teams/{team_slug}/actions/` instead of personal. Mutually exclusive with view_slug. Omit (solo path) for personal items.";
    };
    readonly view_slug: {
        readonly type: "string";
        readonly description: "Optional. Route the write to `<root>/leader-views/{view_slug}/actions/` instead of personal. Mutually exclusive with team_slug. Omit for personal items.";
    };
};
export declare function readScopeFromArgs(args: Record<string, unknown>): ActionScope | undefined;
export declare function describeScope(scope: ActionScope | undefined): string;

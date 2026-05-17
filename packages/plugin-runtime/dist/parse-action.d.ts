export interface SuggestedActionRow {
    label: string;
    host_prompt: string;
    url: string | null;
}
export interface ActionFrontmatter {
    id: string;
    status: string;
    priority: string;
    reason_class: string;
    reason_detail: string;
    source: string | null;
    source_ref: string | null;
    related_entities: string[];
    suggested_actions: SuggestedActionRow[];
    due_by: string | null;
    snoozed_until: string | null;
    completed_at: string | null;
    dismissed_at: string | null;
    created_at: string | null;
    updated_at: string | null;
    team_id: string | null;
    team_slug: string | null;
    source_team: string | null;
    member_relevance_class: string | null;
    relevance_classes: string[];
    done_by_user_slug: string | null;
    done_by_user_id: string | null;
    done_at: string | null;
}
export interface ComposePayloadThreadContext {
    thread_id: string;
    subject: string;
    parent_message_id: string;
    parent_author_real_name: string;
    parent_author_email: string;
    parent_excerpt: string;
    last_message_id: string;
    last_author_real_name: string;
    last_author_email: string;
    last_excerpt: string;
    total_messages: number;
    participants: {
        real_name: string;
        email: string;
    }[];
}
export interface ComposePayloadOnDisk {
    drafted_body: string;
    personalization_signals: string[];
    thread_context: ComposePayloadThreadContext;
    recipients: {
        to: string[];
        cc: string[];
        bcc: string[];
    };
    reply_to_message_id: string;
    gmail_thread_url: string | null;
    account_index: number | null;
}
export interface ParsedAction {
    frontmatter: ActionFrontmatter;
    why_matters: string;
    personalization_fit: string;
    compose_payload: ComposePayloadOnDisk | null;
    email_context: string;
}
/** Shape of a single on-disk action file (frontmatter + body sections). */
export type ActionFile = ParsedAction;
/**
 * Plugin-agnostic YAML-frontmatter extraction.
 *
 * Unlike `parseFrontmatter` (which normalises to the agntux-core
 * `ActionFrontmatter` shape), this helper returns the raw parsed YAML
 * object so callers can index on arbitrary keys. Used by:
 *
 *   - The remote MCP server's S3-backed `ViewToolFs` (in `app/`'s
 *     `lib/mcp/runtime/fs-s3.ts`): called inside `readMany` /
 *     `listWithMeta` to populate the lazy `blob_metadata` cache the
 *     first time a blob is read.
 *   - The local-fs ViewToolContext's `listWithMeta`, to synthesize
 *     metadata on the fly during dev iteration.
 *
 * Returns `null` when the file has no `---`-delimited frontmatter
 * block, or when the YAML inside it can't be parsed. Returns `{}` only
 * if the frontmatter block is genuinely empty (`---\n\n---\n`).
 *
 * The body of the file is intentionally NOT returned — callers that
 * need both parts should use `parseFrontmatter`.
 */
export declare function extractFrontmatterMetadata(text: string): Record<string, unknown> | null;
export declare function parseFrontmatter(text: string): {
    frontmatter: ActionFrontmatter;
    body: string;
};
export declare function extractSection(body: string, header: string): string;
export declare function extractFencedYaml(body: string, header: string): string | null;
/**
 * Parse the gmail `## Compose payload` (or `## Compose payload (gmail)`)
 * body section into a typed object. Returns null when the section is
 * absent or the fenced YAML is malformed/empty.
 */
export declare function parseComposePayload(body: string): ComposePayloadOnDisk | null;
/**
 * Parse an action file from a Buffer or string body. Replaces the legacy
 * `parseActionFile(path)` from agntux-core/mcp-server — the caller is now
 * responsible for the fs read (typically `await ctx.fs.readFile(...)`).
 */
export declare function parseActionFile(content: string | Buffer): ParsedAction;

import { type ViewToolModule } from "@agntux/plugin-runtime";
/**
 * Filter a `list` / `listWithMeta` result down to real action files —
 * `.md` extension, no leading underscore (skips `_index.md` and any
 * other sidecar files that use the same convention), and not an
 * agntux-teams daemon conflict-copy sibling (those parse to the same
 * action id as the original and would produce N+1 phantom rows).
 */
export declare function isActionFilePath(p: string): boolean;
/**
 * Decide whether an action's frontmatter passes the triage-view's
 * status filter — i.e. whether the row is worth fetching the body
 * for. Implements the same predicate the post-parse loop used to
 * apply, but against the metadata-only index so we don't have to
 * read closed actions older than the handled cutoff at all.
 *
 *   - status=open    → always include
 *   - status=snoozed → always include (the view shows a snoozed count)
 *   - status=done    → include only if handled within the cutoff
 *   - status=dismissed → include only if handled within the cutoff
 *   - anything else  → exclude
 *
 * The `handled_at` heuristic mirrors `pickHandledAt` in the post-parse
 * path: prefer `completed_at` on done, `dismissed_at` on dismissed,
 * fall back to `updated_at`, then `created_at`. A handled action with
 * no usable timestamp is included so the renderer can still surface
 * it (rather than silently dropping it on bad data).
 */
export declare function shouldFetchForTriage(meta: Record<string, unknown> | null, handledCutoffMs: number): boolean;
declare const mod: ViewToolModule;
export default mod;
//# sourceMappingURL=agntux-core-view.d.ts.map
/**
 * marketplace-schema.ts
 *
 * SHARED SOURCE OF TRUTH for the AgntUX marketplace `listing.yaml` schema.
 *
 * This file is imported by:
 *   - the marketplace-repo linter at agntux/plugins/scripts/lint-marketplace-metadata.ts (T11)
 *   - the website at agntux/website/lib/marketplace-schema.ts (T36)
 *
 * Per P15 §3 / §5.3, the schema is normative. Edits here ripple to both consumers
 * and require coordinated PRs in agntux/plugins and agntux/website.
 *
 * Reserved-field + unknown-key policy (P15 §3.1.3 / §10.2):
 *
 * The listing object uses `.passthrough()` (lenient) and runs a TWO-PASS
 * `.superRefine` so error reporting is deterministic for downstream tooling
 * (T11 linter messages, T36 "did you mean…" UX):
 *
 *   1. Reserved-field pass — for each key in `RESERVED_LISTING_FIELDS`, if it
 *      appears at the top level we emit an issue with the prefix `E11:` and the
 *      offending key in `path`. This catches `featured`, `download_count`,
 *      `customize_count`, `i18n`, `locale`, `version` per §3.1.3.
 *
 *   2. Unknown-key pass — for each top-level key not in `LISTING_KNOWN_KEYS`
 *      and not already flagged as reserved, we emit an `E05:` issue with the
 *      offending key in `path`. This is the "typo / drift" lane (e.g.
 *      `pricing_tier` after AMEND.4 removed it).
 *
 * `.strict()` would also reject unknowns, but Zod emits its `unrecognized_keys`
 * issue BEFORE `.superRefine` runs — that strips the path and shadows the
 * reserved-field pass, so we explicitly avoid it.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Regexes (P15 §5.3)
// ---------------------------------------------------------------------------

/** GitHub username rules: 1–39 chars, alphanumeric + non-consecutive hyphens. */
export const GitHubHandleRe =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

/** Free-form keyword: lowercase, digits, hyphens; 2–32 chars. */
export const KeywordRe = /^[a-z0-9-]{2,32}$/;

/** Screenshot filename: `NN-slug-name.{png,jpg}` where NN is two digits. */
export const ScreenshotFilenameRe = /^[0-9]{2}-[a-z0-9-]+\.(png|jpg)$/;

/** Plugin slug: lowercase, starts with letter, hyphen-separated, ends alnum. */
export const PluginSlugRe = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/**
 * Connector slug: same shape as plugin slug.
 *
 * Shape-only check. Existence in `agntux/plugins/canonical/connectors.json`
 * is enforced by the linter (T11) — see P15.AMEND.2. The schema deliberately
 * does NOT have access to the canonical registry; that lookup belongs to the
 * lint-time pass that already runs in the marketplace repo.
 */
export const ConnectorSlugRe = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/** UI handler subagent name: same shape as plugin slug. */
export const UiComponentNameRe = /^[a-z][a-z0-9-]*[a-z0-9]$/;

// NOTE: a `Cadence` regex is documented in P15 §5.3 / P3 §2.5.1. It is
// intentionally absent here because `cadence` lives in `plugin.json`, NOT in
// `listing.yaml`. Adding it here would mis-locate the field.

// ---------------------------------------------------------------------------
// Closed enums (P15 §3.2)
// ---------------------------------------------------------------------------

/**
 * The closed category enum. Drives top-level filtering on `/plugins`.
 * Re-evaluate when the marketplace approaches ~30 plugins (P15 §3.2 / §11).
 */
export const CATEGORIES = [
  "productivity",
  "communication",
  "crm",
  "project-management",
  "developer-tools",
  "analytics",
  "notes-knowledge",
  "meta",
] as const;

export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/**
 * Subscription tiers a plugin is available on. P15.AMEND.1 / AMEND.4.
 *
 * Replaces the old single-valued `pricing_tier` field. The listing-side rule
 * is "non-empty subset, no duplicates"; real gating is JWT-based at install
 * time (P2). MVP plugins set all four tiers so the gate exists but is dormant.
 */
export const AVAILABLE_ON_TIERS = [
  "trial",
  "pro",
  "team",
  "enterprise",
] as const;

export const AvailableOnSchema = z.enum(AVAILABLE_ON_TIERS);
export type AvailableOnTier = z.infer<typeof AvailableOnSchema>;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/** Developer block — primary attribution. P15 §3.3. */
export const DeveloperSchema = z
  .object({
    name: z.string().min(1).max(40),
    url: z.string().url().optional(),
    github_handle: z.string().regex(GitHubHandleRe),
  })
  .strict();
export type Developer = z.infer<typeof DeveloperSchema>;

/** Contributor entry — secondary attribution. P15 §3.4. */
export const ContributorSchema = z
  .object({
    github_handle: z.string().regex(GitHubHandleRe),
    role: z.string().max(30).optional(),
  })
  .strict();
export type Contributor = z.infer<typeof ContributorSchema>;

/**
 * Required-source-MCP discriminated union. P15 §3.5.
 *
 * Two shapes:
 *   - `connector` (default, preferred): host-provided Connector marketplace entry.
 *     Note: `connector_slug` shape is checked here; existence in
 *     `agntux/plugins/canonical/connectors.json` is verified by the T11
 *     linter (P15.AMEND.2).
 *   - `npm`     (fallback): npm package
 */
export const RequiresSourceMcpConnectorSchema = z
  .object({
    source: z.literal("connector"),
    connector_slug: z.string().regex(ConnectorSlugRe),
    display_name: z.string().min(1).max(40),
  })
  .strict();
export type RequiresSourceMcpConnector = z.infer<
  typeof RequiresSourceMcpConnectorSchema
>;

export const RequiresSourceMcpNpmSchema = z
  .object({
    source: z.literal("npm"),
    package_name: z.string().min(1).max(120),
    install_url: z.string().url(),
    display_name: z.string().min(1).max(40),
  })
  .strict();
export type RequiresSourceMcpNpm = z.infer<typeof RequiresSourceMcpNpmSchema>;

export const RequiresSourceMcpSchema = z.discriminatedUnion("source", [
  RequiresSourceMcpConnectorSchema,
  RequiresSourceMcpNpmSchema,
]);
export type RequiresSourceMcp = z.infer<typeof RequiresSourceMcpSchema>;

/**
 * Supported prompt entry. P15 §3.6.
 *
 * Linter rule: `prompt` MUST start with `ux:` or `/ux` (per P3 §9.1).
 * The `.refine()` below enforces both prefixes; `.startsWith().or()` would
 * accept a leading prefix only, which is what we want here.
 *
 * `min(3)` is intentional: `/ux` is 3 chars and `ux:` is 3 chars, so the
 * minimum length must accommodate both prefixes (the prompt body itself can
 * be empty for the bare-orchestrator entry like `/ux`).
 */
export const SupportedPromptSchema = z
  .object({
    prompt: z
      .string()
      .min(3)
      .max(200)
      .refine((v) => v.startsWith("ux:") || v.startsWith("/ux"), {
        message: 'prompt must start with "ux:" or "/ux"',
      }),
    purpose: z.string().min(1).max(200),
  })
  .strict();
export type SupportedPrompt = z.infer<typeof SupportedPromptSchema>;

/** UI component descriptor. P15 §3.7. */
export const UiComponentSchema = z
  .object({
    name: z.string().regex(UiComponentNameRe),
    title: z.string().min(1).max(60),
    purpose: z.string().min(1).max(200),
  })
  .strict();
export type UiComponent = z.infer<typeof UiComponentSchema>;

/** Support block. P15 §3.1.1. */
export const SupportSchema = z
  .object({
    url: z.string().url(),
    email: z.string().email(),
  })
  .strict();
export type Support = z.infer<typeof SupportSchema>;

// ---------------------------------------------------------------------------
// Reserved-field + known-key registries (P15 §3.1.3, error codes E05/E11)
// ---------------------------------------------------------------------------

/**
 * Keys that MUST NOT appear in `listing.yaml`. Surfaced as E11 by the
 * reserved-field pass in `ListingSchema.superRefine`.
 */
export const RESERVED_LISTING_FIELDS = [
  "featured",
  "download_count",
  "customize_count",
  "i18n",
  "locale",
  "version",
] as const;
export type ReservedListingField = (typeof RESERVED_LISTING_FIELDS)[number];

/**
 * Every key the listing schema knows about. Used by the unknown-key pass to
 * decide whether a non-reserved top-level key is an unrecognised typo (E05).
 *
 * Keep in lockstep with the `z.object({...})` shape of `ListingSchema`. T11
 * and T36 both consume this for "did you mean…" diagnostics.
 */
export const LISTING_KNOWN_KEYS = [
  "tagline",
  "description",
  "categories",
  "keywords",
  "available_on",
  "data_ingested",
  "supported_prompts",
  "ui_components",
  "screenshot_order",
  "demo_url",
  "support",
  "requires_plugins",
  "requires_source_mcp",
  "developer",
  "contributors",
] as const;
export type ListingKnownKey = (typeof LISTING_KNOWN_KEYS)[number];

// ---------------------------------------------------------------------------
// Listing schema (P15 §3.1)
// ---------------------------------------------------------------------------

/**
 * The listing.yaml top-level schema.
 *
 * Notes:
 *   - Object is `.passthrough()`, not `.strict()`. The two-pass `.superRefine`
 *     below is the sole source of truth for reserved-field (E11) and
 *     unknown-key (E05) errors so that downstream tooling sees consistent
 *     codes + paths.
 *   - `recommended_ingest_cadence` is intentionally absent: it lives in
 *     plugin.json (P15 §2.5.1), not in listing.yaml.
 *   - `pricing_tier` is intentionally absent: dropped per P15.AMEND.4 in favour
 *     of `available_on`.
 */
export const ListingSchema = z
  .object({
    tagline: z.string().min(1).max(80),
    description: z.string().min(1).max(500),
    categories: z.array(CategorySchema).min(1).max(3),
    keywords: z.array(z.string().regex(KeywordRe)).min(1).max(10),
    /**
     * Subscription tiers a plugin is available on. Required, non-empty,
     * deduplicated subset of `AVAILABLE_ON_TIERS` (P15.AMEND.1).
     */
    available_on: z
      .array(AvailableOnSchema)
      .min(1)
      .max(AVAILABLE_ON_TIERS.length)
      .refine((arr) => new Set(arr).size === arr.length, {
        message: "available_on must not contain duplicate tiers",
      }),
    data_ingested: z.array(z.string().min(1).max(120)).max(12).optional(),
    supported_prompts: z.array(SupportedPromptSchema).max(20).optional(),
    ui_components: z.array(UiComponentSchema).max(20).optional(),
    screenshot_order: z
      .array(z.string().regex(ScreenshotFilenameRe))
      .optional(),
    demo_url: z.string().url().optional(),
    support: SupportSchema,
    requires_plugins: z.array(z.string().regex(PluginSlugRe)).optional(),
    requires_source_mcp: RequiresSourceMcpSchema.optional(),
    developer: DeveloperSchema,
    contributors: z.array(ContributorSchema).max(8).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const raw = value as Record<string, unknown>;

    // Pass 1: reserved-field rejection (E11). We check the parsed object's
    // own enumerable keys — `.passthrough()` preserves them on `value`, so
    // `featured: true` etc. land here with their original path.
    const reserved = new Set<string>(RESERVED_LISTING_FIELDS);
    for (const key of RESERVED_LISTING_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `E11: reserved field '${key}' must not appear at top level`,
        });
      }
    }

    // Pass 2: unknown-key rejection (E05). Anything not in the known set and
    // not already flagged as reserved is a typo / drift case.
    const known = new Set<string>(LISTING_KNOWN_KEYS);
    for (const key of Object.keys(raw)) {
      if (known.has(key)) continue;
      if (reserved.has(key)) continue; // already flagged as E11 above
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `E05: unknown listing field '${key}' — possible typo`,
      });
    }

    // Cross-check: developer.github_handle is not duplicated in contributors[].
    if (value.contributors) {
      const dev = value.developer.github_handle;
      const seen = new Set<string>();
      for (let i = 0; i < value.contributors.length; i++) {
        const c = value.contributors[i];
        if (c.github_handle === dev) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contributors", i, "github_handle"],
            message:
              "primary developer must not be repeated in contributors[]",
          });
        }
        if (seen.has(c.github_handle)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contributors", i, "github_handle"],
            message: `duplicate contributor handle "${c.github_handle}"`,
          });
        }
        seen.add(c.github_handle);
      }
    }
  });

export type Listing = z.infer<typeof ListingSchema>;

// ---------------------------------------------------------------------------
// Aggregate-index schema (P15 §6.4)
// ---------------------------------------------------------------------------

/**
 * Shape of `marketplace/index.json` — CI-generated aggregate of every
 * listing.yaml at agntux/plugins. Read by the website at request time.
 */
export const AggregateIndexSchema = z
  .object({
    /** ISO-8601 timestamp the index was generated by CI. */
    generated_at: z.string().datetime({ offset: true }),
    /** Map from plugin slug -> validated Listing. */
    plugins: z.record(z.string().regex(PluginSlugRe), ListingSchema),
  })
  .strict();
export type AggregateIndex = z.infer<typeof AggregateIndexSchema>;

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

/** All exported schemas + key registries, grouped for downstream consumers. */
export const MarketplaceSchemas = {
  Listing: ListingSchema,
  AggregateIndex: AggregateIndexSchema,
  Developer: DeveloperSchema,
  Contributor: ContributorSchema,
  RequiresSourceMcp: RequiresSourceMcpSchema,
  RequiresSourceMcpConnector: RequiresSourceMcpConnectorSchema,
  RequiresSourceMcpNpm: RequiresSourceMcpNpmSchema,
  SupportedPrompt: SupportedPromptSchema,
  UiComponent: UiComponentSchema,
  Support: SupportSchema,
  Category: CategorySchema,
  AvailableOn: AvailableOnSchema,
  RESERVED_LISTING_FIELDS,
  LISTING_KNOWN_KEYS,
  AVAILABLE_ON_TIERS,
  CATEGORIES,
} as const;

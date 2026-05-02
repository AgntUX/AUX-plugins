// pivot — emits a host_prompt back to the host to navigate to an entity view.
// Does NOT write any files. Two-layer input validation:
//
//   1. Shape check: subtype + slug must be kebab-case identifiers per P3 §1.4.
//      This rejects malformed inputs (containing `/`, `..`, control chars,
//      shell metacharacters, etc.) BEFORE they reach the host_prompt.
//   2. Boundary check: the resolved entity path must stay within
//      <agntux project root>/entities/. This is defense-in-depth — the shape
//      check above should already eliminate every input that could escape.

import { join, resolve, relative } from "node:path";
import { expectedAgntuxRoot } from "../agntux-root.js";

function entitiesDir(): string {
  return join(expectedAgntuxRoot(), "entities");
}

// Kebab-case identifier per P3 §1.4: lowercase letters/digits/hyphens, must
// start with a letter, max 64 chars. Rejects underscores, slashes, dots,
// shell metas, control chars, mixed case, leading/trailing hyphens.
const SLUG_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$|^[a-z]$/;
// Subtype directory names: same shape, slightly more permissive (allow
// single-letter subtype for forward-compat, e.g. a hypothetical "p" subtype).
const SUBTYPE_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$|^[a-z]$/;

function guardEntityShape(subtype: string, slug: string): void {
  if (!SUBTYPE_RE.test(subtype)) {
    throw new Error(
      `Invalid subtype "${subtype}": must be a kebab-case identifier (lowercase letters, digits, hyphens; starts with a letter; max 64 chars).`
    );
  }
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}": must be a kebab-case identifier (lowercase letters, digits, hyphens; starts with a letter; max 64 chars).`
    );
  }
}

function guardEntityPath(subtype: string, slug: string): void {
  // Resolve the entity path and confirm it stays within <root>/entities/.
  const dir = entitiesDir();
  const resolved = resolve(dir, subtype, `${slug}.md`);
  const rel = relative(dir, resolved);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error(
      `Path traversal rejected: subtype "${subtype}" / slug "${slug}" resolves outside <agntux project root>/entities/`
    );
  }
}

export const pivotTool = {
  description:
    "Navigate to an entity view in the orchestrator UI. Returns a host_prompt that opens the entity browser for the specified entity.",
  inputSchema: {
    type: "object" as const,
    properties: {
      subtype: {
        type: "string",
        description: "Entity subtype directory (e.g. companies, people, topics)",
      },
      slug: {
        type: "string",
        description: "Entity slug (e.g. acme-corp)",
      },
    },
    required: ["subtype", "slug"],
  },
  async handler(args: Record<string, unknown>) {
    const subtype = String(args.subtype ?? "");
    const slug = String(args.slug ?? "");
    if (!subtype) throw new Error("subtype is required");
    if (!slug) throw new Error("slug is required");

    guardEntityShape(subtype, slug);
    guardEntityPath(subtype, slug);

    const hostPrompt = `ux: Use the agntux-core plugin to open the entity browser for ${subtype}/${slug}.`;

    return {
      content: [
        {
          type: "text",
          text: hostPrompt,
        },
      ],
      // The host reads this _meta to trigger navigation.
      _meta: {
        host_prompt: hostPrompt,
        entity: { subtype, slug },
      },
    };
  },
};

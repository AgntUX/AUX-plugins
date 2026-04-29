// pivot — emits a host_prompt back to the host to navigate to an entity view.
// Does NOT write any files. Path guards still apply to prevent injection via entity paths.

import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";

const ENTITIES_DIR = join(homedir(), "agntux", "entities");

function guardEntityPath(subtype: string, slug: string): void {
  // Resolve the entity path and confirm it stays within ~/agntux/entities/.
  const resolved = resolve(ENTITIES_DIR, subtype, `${slug}.md`);
  const rel = relative(ENTITIES_DIR, resolved);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error(
      `Path traversal rejected: subtype "${subtype}" / slug "${slug}" resolves outside ~/agntux/entities/`
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

// Minimal frontmatter patcher for action-item files.
//
// Ported from `mcp-server/src/frontmatter.ts` — pure string transformation,
// zero node-fs dependencies, safe for inclusion in the view-tool bundle
// (which runs under the trust-model contract of importing ONLY from
// `@agntux/plugin-runtime`).

const FM_OPEN = /^---\n/;

/**
 * Apply a patch to the frontmatter of a markdown file.
 * Returns the full file contents with the frontmatter updated.
 * Throws if the file has no valid frontmatter block.
 */
export function setFrontmatter(
  raw: string,
  patch: Record<string, unknown>,
): string {
  const openMatch = FM_OPEN.exec(raw);
  if (!openMatch) throw new Error("File has no frontmatter opening ---");

  const afterOpen = raw.slice(openMatch[0].length);
  const closeIdx = afterOpen.indexOf("\n---\n");
  if (closeIdx === -1) throw new Error("File has no frontmatter closing ---");

  const yamlBlock = afterOpen.slice(0, closeIdx);
  const body = afterOpen.slice(closeIdx + "\n---\n".length);

  const pairs: Array<[string, string]> = [];
  const seenKeys = new Set<string>();

  for (const line of yamlBlock.split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (m) {
      pairs.push([m[1]!, m[2]!]);
      seenKeys.add(m[1]!);
    } else {
      // Continuation line (block scalar, etc.) — preserve verbatim.
      pairs.push(["", line]);
    }
  }

  const newKeys: string[] = [];
  for (const key of Object.keys(patch)) {
    if (!seenKeys.has(key)) newKeys.push(key);
  }

  const patchedPairs = pairs.map(([key, rawVal]) => {
    if (key && Object.hasOwn(patch, key)) {
      return [key, serialiseValue(patch[key])] as [string, string];
    }
    return [key, rawVal] as [string, string];
  });

  for (const key of newKeys) {
    patchedPairs.push([key, serialiseValue(patch[key])]);
  }

  const newYaml = patchedPairs
    .map(([key, val]) => (key ? `${key}: ${val}` : val))
    .join("\n");

  return `---\n${newYaml}\n---\n${body}`;
}

// ISO 8601 / RFC 3339 timestamp pattern — safe to leave unquoted in YAML.
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

function serialiseValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (ISO_TIMESTAMP_RE.test(v)) return v;
    if (
      v === "" ||
      v === "null" ||
      v === "true" ||
      v === "false" ||
      /^[-+]?\d/.test(v) ||
      v.includes(":") ||
      v.includes("#") ||
      v.startsWith(" ") ||
      v.endsWith(" ")
    ) {
      return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return v;
  }
  return JSON.stringify(v);
}

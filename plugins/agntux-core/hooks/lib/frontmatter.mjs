// Minimal YAML parser for the frontmatter shapes P3 specifies.
// Supports: scalars (string, int, bool, null), single-line lists [a, b, c],
// block lists with leading "- ", and flat key: value maps.
// Does NOT support: nested maps beyond one level, anchors, multi-document streams.

export function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { frontmatter: {}, body: raw };
  const fm = parseYaml(m[1]);
  const body = raw.slice(m[0].length);
  return { frontmatter: fm, body };
}

function parseYaml(text) {
  const obj = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) { i++; continue; }
    const [, key, rest] = m;
    if (rest === "") {
      // Block list or block map follows.
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s/.test(lines[j])) {
        items.push(lines[j].replace(/^\s+-\s/, "").trim());
        j++;
      }
      if (items.length) {
        obj[key] = items;
        i = j;
        continue;
      }
      // Block map: collect indented "  inner: value" lines.
      const map = {};
      while (j < lines.length && /^\s+[a-zA-Z_]/.test(lines[j])) {
        const km = lines[j].match(/^\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.+)$/);
        if (km) map[km[1]] = parseScalar(km[2]);
        j++;
      }
      obj[key] = Object.keys(map).length ? map : null;
      i = j;
      continue;
    }
    // Inline list?
    if (rest.startsWith("[") && rest.endsWith("]")) {
      obj[key] = rest.slice(1, -1).split(",").map((s) => parseScalar(s.trim()));
      i++;
      continue;
    }
    obj[key] = parseScalar(rest);
    i++;
  }
  return obj;
}

function parseScalar(s) {
  if (s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

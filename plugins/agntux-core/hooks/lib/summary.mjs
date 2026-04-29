// Derives the one-line summary from an entity or action-item file.
// Direct port of P3 §5.3's deriveSummary algorithm — regex-based, no LLM.
// headingName: "Summary" for entity files, "Why this matters" for action items.

const FM_RE = /^---\n[\s\S]*?\n---\n/;
const HEADING_RE = (h) => new RegExp(`^##[ \\t]+${h}[ \\t]*$`, "m");
const ANY_HEADING_RE = /^#{1,6}[ \t]/m;
const BLANK_RE = /^\s*$/;
const WIKI_RE = /\[\[([^\]]+)\]\]/g;
const SENTENCE_RE = /[.!?](\s|$)/;

export function deriveSummary(text, headingName) {
  const fmMatch = text.match(FM_RE);
  const body = fmMatch ? text.slice(fmMatch[0].length) : text;
  const headingMatch = body.match(HEADING_RE(headingName));
  if (!headingMatch) return "(no summary)";

  const afterHeading = body.slice(headingMatch.index + headingMatch[0].length).replace(/^\n/, "");
  const nextHeading = afterHeading.match(ANY_HEADING_RE);
  const region = nextHeading ? afterHeading.slice(0, nextHeading.index) : afterHeading;

  const lines = region.split("\n");
  const firstNonBlank = lines.findIndex((l) => !BLANK_RE.test(l));
  if (firstNonBlank === -1) return "(no summary)";
  const paraEnd = lines.findIndex((l, i) => i > firstNonBlank && BLANK_RE.test(l));
  const paraLines = lines.slice(firstNonBlank, paraEnd === -1 ? lines.length : paraEnd);
  let s = paraLines.join(" ").replace(WIKI_RE, "$1").replace(/\s+/g, " ").trim();
  if (!s) return "(no summary)";

  const stop = s.search(SENTENCE_RE);
  if (stop !== -1 && stop < 120) return s.slice(0, stop + 1);
  if (s.length <= 120) return s;
  let cut = s.slice(0, 119);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 80) cut = cut.slice(0, lastSpace);
  return cut + "…";
}

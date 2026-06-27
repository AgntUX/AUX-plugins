// src/agntux-canva-view.ts
import { renderConfirmationText } from "@agntux/plugin-runtime";
var replyDescriptor = {
  name: "agntux_canva_reply",
  description: "Renders an inline iframe to reply to a comment on a Canva design. Shows the design title, a quoted comment block with the commenter and excerpt, and a pre-filled editable reply textarea. Use this when the user wants to respond to a comment or mention on one of their Canva designs. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
  inputSchema: {
    type: "object",
    properties: {
      design_url: { type: "string", description: "Direct URL to the Canva design." },
      design_id: { type: "string", description: "Canva design ID." },
      design_title: { type: "string", description: "Title of the Canva design." },
      comment_id: { type: "string", description: "ID of the comment being replied to." },
      comment_author: { type: "string", description: "Name of the comment author." },
      comment_excerpt: { type: "string", description: "Excerpt of the comment being replied to." },
      draft_body: { type: "string", description: "Pre-drafted reply text." },
      personalization_signals: {
        type: "string",
        description: "Context used to personalize the draft."
      }
    }
  },
  outputSchema: {
    type: "object",
    properties: {
      design_url: { type: "string" },
      design_id: { type: "string" },
      design_title: { type: "string" },
      comment_id: { type: "string" },
      comment_author: { type: "string" },
      comment_excerpt: { type: "string" },
      draft_body: { type: "string" },
      personalization_signals: { type: "string" }
    },
    required: [
      "design_url",
      "design_id",
      "design_title",
      "comment_id",
      "comment_author",
      "comment_excerpt",
      "draft_body",
      "personalization_signals"
    ]
  },
  ui_resource_uri: "ui://agntux-canva/reply",
  data_paths: [{ pattern: "actions/{id}-canva-comment.md", scope: "personal" }]
};
var replyTool = {
  descriptor: replyDescriptor,
  async handle(args, _ctx) {
    const out = {
      design_url: typeof args.design_url === "string" ? args.design_url : "",
      design_id: typeof args.design_id === "string" ? args.design_id : "",
      design_title: typeof args.design_title === "string" ? args.design_title : "",
      comment_id: typeof args.comment_id === "string" ? args.comment_id : "",
      comment_author: typeof args.comment_author === "string" ? args.comment_author : "",
      comment_excerpt: typeof args.comment_excerpt === "string" ? args.comment_excerpt : "",
      draft_body: typeof args.draft_body === "string" ? args.draft_body : "",
      personalization_signals: typeof args.personalization_signals === "string" ? args.personalization_signals : ""
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Canva reply UI") }],
      structuredContent: out
    };
  }
};
var commentDescriptor = {
  name: "agntux_canva_comment",
  description: "Renders an inline iframe to leave a new comment on a Canva design. Shows the design title and a pre-filled editable comment textarea. Use this when the user wants to add a fresh comment to a Canva design (not a reply to an existing comment). This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
  inputSchema: {
    type: "object",
    properties: {
      design_url: { type: "string", description: "Direct URL to the Canva design." },
      design_id: { type: "string", description: "Canva design ID." },
      design_title: { type: "string", description: "Title of the Canva design." },
      draft_body: { type: "string", description: "Pre-drafted comment text." },
      personalization_signals: {
        type: "string",
        description: "Context used to personalize the draft."
      }
    }
  },
  outputSchema: {
    type: "object",
    properties: {
      design_url: { type: "string" },
      design_id: { type: "string" },
      design_title: { type: "string" },
      draft_body: { type: "string" },
      personalization_signals: { type: "string" }
    },
    required: [
      "design_url",
      "design_id",
      "design_title",
      "draft_body",
      "personalization_signals"
    ]
  },
  ui_resource_uri: "ui://agntux-canva/comment",
  data_paths: [{ pattern: "actions/{id}-canva-comment.md", scope: "personal" }]
};
var commentTool = {
  descriptor: commentDescriptor,
  async handle(args, _ctx) {
    const out = {
      design_url: typeof args.design_url === "string" ? args.design_url : "",
      design_id: typeof args.design_id === "string" ? args.design_id : "",
      design_title: typeof args.design_title === "string" ? args.design_title : "",
      draft_body: typeof args.draft_body === "string" ? args.draft_body : "",
      personalization_signals: typeof args.personalization_signals === "string" ? args.personalization_signals : ""
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Canva comment UI") }],
      structuredContent: out
    };
  }
};
function safeFormatArray(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      result.push(item);
    }
  }
  return result;
}
var exportDescriptor = {
  name: "agntux_canva_export",
  description: "Renders an inline iframe to export a Canva design to a shareable file. Shows the design title, a format picker (from the design's supported formats), and a page range control. The user selects format and pages then clicks Export. Use this when the user wants to download or share a Canva design as PDF, PNG, JPG, PPTX, GIF, MP4, or CSV. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
  inputSchema: {
    type: "object",
    properties: {
      design_url: { type: "string", description: "Direct URL to the Canva design." },
      design_id: { type: "string", description: "Canva design ID." },
      design_title: { type: "string", description: "Title of the Canva design." },
      available_formats: {
        type: "array",
        items: { type: "string" },
        description: 'Format types supported for this design (e.g. ["pdf", "png"]).'
      },
      default_format: {
        type: "string",
        description: "The format to pre-select in the picker."
      },
      page_count: {
        type: "number",
        description: "Total number of pages in the design."
      }
    }
  },
  outputSchema: {
    type: "object",
    properties: {
      design_url: { type: "string" },
      design_id: { type: "string" },
      design_title: { type: "string" },
      available_formats: {
        type: "array",
        items: { type: "string" }
      },
      default_format: { type: "string" },
      page_count: { type: "number" }
    },
    required: [
      "design_url",
      "design_id",
      "design_title",
      "available_formats",
      "default_format",
      "page_count"
    ]
  },
  ui_resource_uri: "ui://agntux-canva/export",
  data_paths: [{ pattern: "actions/{id}-canva-design.md", scope: "personal" }]
};
var exportTool = {
  descriptor: exportDescriptor,
  async handle(args, _ctx) {
    const formats = safeFormatArray(args.available_formats);
    const out = {
      design_url: typeof args.design_url === "string" ? args.design_url : "",
      design_id: typeof args.design_id === "string" ? args.design_id : "",
      design_title: typeof args.design_title === "string" ? args.design_title : "",
      available_formats: formats,
      default_format: typeof args.default_format === "string" ? args.default_format : formats.length > 0 ? formats[0] : "pdf",
      page_count: typeof args.page_count === "number" ? args.page_count : 1
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Canva export UI") }],
      structuredContent: out
    };
  }
};
var agntux_canva_view_default = {
  viewTools: [replyTool, commentTool, exportTool]
};
export {
  agntux_canva_view_default as default
};

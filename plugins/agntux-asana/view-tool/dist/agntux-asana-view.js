// src/agntux-asana-view.ts
import { renderConfirmationText } from "@agntux/plugin-runtime";
var commentDescriptor = {
  name: "agntux_asana_comment",
  description: "Renders an inline iframe for adding a comment to an Asana task. Shows the task context and a pre-filled comment textarea.",
  inputSchema: {
    type: "object",
    properties: {
      task_gid: { type: "string", description: "Asana task GID." },
      task_url: { type: "string", description: "Deep link to the Asana task." },
      task_title: { type: "string", description: "Task title." },
      project_name: { type: "string", description: "Project the task belongs to." },
      due_on: { type: "string", description: "Due date (YYYY-MM-DD)." },
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
      task_gid: { type: "string" },
      task_url: { type: "string" },
      task_title: { type: "string" },
      project_name: { type: "string" },
      due_on: { type: "string" },
      draft_body: { type: "string" },
      personalization_signals: { type: "string" }
    },
    required: ["task_gid", "task_url", "task_title", "project_name", "due_on", "draft_body", "personalization_signals"]
  },
  ui_resource_uri: "ui://agntux-asana/comment",
  data_paths: [{ pattern: "actions/{gid}-asana-task.md", scope: "personal" }]
};
var commentTool = {
  descriptor: commentDescriptor,
  async handle(args, _ctx) {
    const out = {
      task_gid: typeof args.task_gid === "string" ? args.task_gid : "",
      task_url: typeof args.task_url === "string" ? args.task_url : "",
      task_title: typeof args.task_title === "string" ? args.task_title : "",
      project_name: typeof args.project_name === "string" ? args.project_name : "",
      due_on: typeof args.due_on === "string" ? args.due_on : "",
      draft_body: typeof args.draft_body === "string" ? args.draft_body : "",
      personalization_signals: typeof args.personalization_signals === "string" ? args.personalization_signals : ""
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Asana comment UI") }],
      structuredContent: out
    };
  }
};
var completeDescriptor = {
  name: "agntux_asana_complete",
  description: "Renders an inline iframe to mark an Asana task complete or change its due date.",
  inputSchema: {
    type: "object",
    properties: {
      task_gid: { type: "string" },
      task_url: { type: "string" },
      task_title: { type: "string" },
      project_name: { type: "string" },
      completed: { type: "boolean", description: "Current completion status." },
      due_on: { type: "string", description: "Current due date (YYYY-MM-DD)." }
    }
  },
  outputSchema: {
    type: "object",
    properties: {
      task_gid: { type: "string" },
      task_url: { type: "string" },
      task_title: { type: "string" },
      project_name: { type: "string" },
      completed: { type: "boolean" },
      due_on: { type: "string" }
    },
    required: ["task_gid", "task_url", "task_title", "project_name", "completed", "due_on"]
  },
  ui_resource_uri: "ui://agntux-asana/complete",
  data_paths: [{ pattern: "actions/{gid}-asana-task.md", scope: "personal" }]
};
var completeTool = {
  descriptor: completeDescriptor,
  async handle(args, _ctx) {
    const out = {
      task_gid: typeof args.task_gid === "string" ? args.task_gid : "",
      task_url: typeof args.task_url === "string" ? args.task_url : "",
      task_title: typeof args.task_title === "string" ? args.task_title : "",
      project_name: typeof args.project_name === "string" ? args.project_name : "",
      completed: typeof args.completed === "boolean" ? args.completed : false,
      due_on: typeof args.due_on === "string" ? args.due_on : ""
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Asana task complete UI") }],
      structuredContent: out
    };
  }
};
var assignDescriptor = {
  name: "agntux_asana_assign",
  description: "Renders an inline iframe to reassign an Asana task to a team member.",
  inputSchema: {
    type: "object",
    properties: {
      task_gid: { type: "string" },
      task_url: { type: "string" },
      task_title: { type: "string" },
      current_assignee: { type: "string", description: "Name of current assignee." },
      candidate_assignees: {
        type: "array",
        items: {
          type: "object",
          properties: {
            gid: { type: "string" },
            name: { type: "string" }
          },
          required: ["gid", "name"]
        },
        description: "List of potential assignees."
      },
      note_body: { type: "string", description: "Optional note to include with reassignment." }
    }
  },
  outputSchema: {
    type: "object",
    properties: {
      task_gid: { type: "string" },
      task_url: { type: "string" },
      task_title: { type: "string" },
      current_assignee: { type: "string" },
      candidate_assignees: {
        type: "array",
        items: {
          type: "object",
          properties: {
            gid: { type: "string" },
            name: { type: "string" }
          }
        }
      },
      note_body: { type: "string" }
    },
    required: ["task_gid", "task_url", "task_title", "current_assignee", "candidate_assignees", "note_body"]
  },
  ui_resource_uri: "ui://agntux-asana/assign",
  data_paths: [{ pattern: "actions/{gid}-asana-task.md", scope: "personal" }]
};
function safeAssignees(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (item !== null && typeof item === "object" && typeof item.gid === "string" && typeof item.name === "string") {
      result.push({
        gid: item.gid,
        name: item.name
      });
    }
  }
  return result;
}
var assignTool = {
  descriptor: assignDescriptor,
  async handle(args, _ctx) {
    const out = {
      task_gid: typeof args.task_gid === "string" ? args.task_gid : "",
      task_url: typeof args.task_url === "string" ? args.task_url : "",
      task_title: typeof args.task_title === "string" ? args.task_title : "",
      current_assignee: typeof args.current_assignee === "string" ? args.current_assignee : "",
      candidate_assignees: safeAssignees(args.candidate_assignees),
      note_body: typeof args.note_body === "string" ? args.note_body : ""
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Asana task assign UI") }],
      structuredContent: out
    };
  }
};
var createDescriptor = {
  name: "agntux_asana_create",
  description: "Renders an inline iframe to create a follow-up Asana task, with assignee, due date, and project selection.",
  inputSchema: {
    type: "object",
    properties: {
      parent_task_title: {
        type: "string",
        description: "Title of the task this follow-up is created from."
      },
      draft_name: { type: "string", description: "Pre-drafted name for the new task." },
      candidate_assignees: {
        type: "array",
        items: {
          type: "object",
          properties: {
            gid: { type: "string" },
            name: { type: "string" }
          },
          required: ["gid", "name"]
        }
      },
      due_on: { type: "string", description: "Suggested due date (YYYY-MM-DD)." },
      candidate_projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            gid: { type: "string" },
            name: { type: "string" }
          },
          required: ["gid", "name"]
        }
      }
    }
  },
  outputSchema: {
    type: "object",
    properties: {
      parent_task_title: { type: "string" },
      draft_name: { type: "string" },
      candidate_assignees: {
        type: "array",
        items: {
          type: "object",
          properties: {
            gid: { type: "string" },
            name: { type: "string" }
          }
        }
      },
      due_on: { type: "string" },
      candidate_projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            gid: { type: "string" },
            name: { type: "string" }
          }
        }
      }
    },
    required: ["parent_task_title", "draft_name", "candidate_assignees", "due_on", "candidate_projects"]
  },
  ui_resource_uri: "ui://agntux-asana/create",
  data_paths: [{ pattern: "actions/{gid}-asana-task.md", scope: "personal" }]
};
function safeProjects(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (item !== null && typeof item === "object" && typeof item.gid === "string" && typeof item.name === "string") {
      result.push({
        gid: item.gid,
        name: item.name
      });
    }
  }
  return result;
}
var createTool = {
  descriptor: createDescriptor,
  async handle(args, _ctx) {
    const out = {
      parent_task_title: typeof args.parent_task_title === "string" ? args.parent_task_title : "",
      draft_name: typeof args.draft_name === "string" ? args.draft_name : "",
      candidate_assignees: safeAssignees(args.candidate_assignees),
      due_on: typeof args.due_on === "string" ? args.due_on : "",
      candidate_projects: safeProjects(args.candidate_projects)
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Asana create task UI") }],
      structuredContent: out
    };
  }
};
var agntux_asana_view_default = {
  viewTools: [commentTool, completeTool, assignTool, createTool]
};
export {
  agntux_asana_view_default as default
};

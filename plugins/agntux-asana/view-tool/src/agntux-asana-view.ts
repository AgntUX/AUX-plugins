/**
 * agntux-asana-view.ts — view-tool handler module for agntux-asana.
 *
 * Exports four view tools (comment, complete, assign, create).
 * These are connector-targeted; all write operations go through the
 * connector's mutation tools (add_comment, update_tasks, create_tasks).
 *
 * Handler must be render-safe: empty/missing args must return a
 * placeholder payload — never throw.
 */

import type {
  ViewTool,
  ViewToolContext,
  ViewToolDescriptor,
} from "@agntux/plugin-runtime";
import { renderConfirmationText } from "@agntux/plugin-runtime";

// ---------------------------------------------------------------------------
// Shared placeholder helpers
// ---------------------------------------------------------------------------

function placeholderTask() {
  return {
    task_gid: "",
    task_url: "",
    task_title: "",
    project_name: "",
    due_on: "",
  };
}

// ---------------------------------------------------------------------------
// 1. comment — "Add a comment to an Asana task"
// ---------------------------------------------------------------------------

interface CommentArgs {
  task_gid?: string;
  task_url?: string;
  task_title?: string;
  project_name?: string;
  due_on?: string;
  draft_body?: string;
  personalization_signals?: string;
}

interface CommentOut {
  task_gid: string;
  task_url: string;
  task_title: string;
  project_name: string;
  due_on: string;
  draft_body: string;
  personalization_signals: string;
}

const commentDescriptor: ViewToolDescriptor = {
  name: "agntux_asana_comment",
  description:
    "Renders an inline iframe for adding a comment to an Asana task. Shows the task context and a pre-filled comment textarea.",
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
        description: "Context used to personalize the draft.",
      },
    },
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
      personalization_signals: { type: "string" },
    },
    required: ["task_gid", "task_url", "task_title", "project_name", "due_on", "draft_body", "personalization_signals"],
  },
  ui_resource_uri: "ui://agntux-asana/comment",
  data_paths: [{ pattern: "actions/{gid}-asana-task.md", scope: "personal" }],
};

const commentTool: ViewTool<CommentArgs, CommentOut> = {
  descriptor: commentDescriptor,
  async handle(args: CommentArgs, _ctx: ViewToolContext) {
    const out: CommentOut = {
      task_gid: typeof args.task_gid === "string" ? args.task_gid : "",
      task_url: typeof args.task_url === "string" ? args.task_url : "",
      task_title: typeof args.task_title === "string" ? args.task_title : "",
      project_name: typeof args.project_name === "string" ? args.project_name : "",
      due_on: typeof args.due_on === "string" ? args.due_on : "",
      draft_body: typeof args.draft_body === "string" ? args.draft_body : "",
      personalization_signals:
        typeof args.personalization_signals === "string"
          ? args.personalization_signals
          : "",
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Asana comment UI") }],
      structuredContent: out,
    };
  },
};

// ---------------------------------------------------------------------------
// 2. complete — "Mark task complete or change due date"
// ---------------------------------------------------------------------------

interface CompleteArgs {
  task_gid?: string;
  task_url?: string;
  task_title?: string;
  project_name?: string;
  completed?: boolean;
  due_on?: string;
}

interface CompleteOut {
  task_gid: string;
  task_url: string;
  task_title: string;
  project_name: string;
  completed: boolean;
  due_on: string;
}

const completeDescriptor: ViewToolDescriptor = {
  name: "agntux_asana_complete",
  description:
    "Renders an inline iframe to mark an Asana task complete or change its due date.",
  inputSchema: {
    type: "object",
    properties: {
      task_gid: { type: "string" },
      task_url: { type: "string" },
      task_title: { type: "string" },
      project_name: { type: "string" },
      completed: { type: "boolean", description: "Current completion status." },
      due_on: { type: "string", description: "Current due date (YYYY-MM-DD)." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      task_gid: { type: "string" },
      task_url: { type: "string" },
      task_title: { type: "string" },
      project_name: { type: "string" },
      completed: { type: "boolean" },
      due_on: { type: "string" },
    },
    required: ["task_gid", "task_url", "task_title", "project_name", "completed", "due_on"],
  },
  ui_resource_uri: "ui://agntux-asana/complete",
  data_paths: [{ pattern: "actions/{gid}-asana-task.md", scope: "personal" }],
};

const completeTool: ViewTool<CompleteArgs, CompleteOut> = {
  descriptor: completeDescriptor,
  async handle(args: CompleteArgs, _ctx: ViewToolContext) {
    const out: CompleteOut = {
      task_gid: typeof args.task_gid === "string" ? args.task_gid : "",
      task_url: typeof args.task_url === "string" ? args.task_url : "",
      task_title: typeof args.task_title === "string" ? args.task_title : "",
      project_name: typeof args.project_name === "string" ? args.project_name : "",
      completed: typeof args.completed === "boolean" ? args.completed : false,
      due_on: typeof args.due_on === "string" ? args.due_on : "",
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Asana task complete UI") }],
      structuredContent: out,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. assign — "Reassign the task to someone"
// ---------------------------------------------------------------------------

interface Assignee {
  gid: string;
  name: string;
}

interface AssignArgs {
  task_gid?: string;
  task_url?: string;
  task_title?: string;
  current_assignee?: string;
  candidate_assignees?: Assignee[];
  note_body?: string;
}

interface AssignOut {
  task_gid: string;
  task_url: string;
  task_title: string;
  current_assignee: string;
  candidate_assignees: Assignee[];
  note_body: string;
}

const assignDescriptor: ViewToolDescriptor = {
  name: "agntux_asana_assign",
  description:
    "Renders an inline iframe to reassign an Asana task to a team member.",
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
            name: { type: "string" },
          },
          required: ["gid", "name"],
        },
        description: "List of potential assignees.",
      },
      note_body: { type: "string", description: "Optional note to include with reassignment." },
    },
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
            name: { type: "string" },
          },
        },
      },
      note_body: { type: "string" },
    },
    required: ["task_gid", "task_url", "task_title", "current_assignee", "candidate_assignees", "note_body"],
  },
  ui_resource_uri: "ui://agntux-asana/assign",
  data_paths: [{ pattern: "actions/{gid}-asana-task.md", scope: "personal" }],
};

function safeAssignees(value: unknown): Assignee[] {
  if (!Array.isArray(value)) return [];
  const result: Assignee[] = [];
  for (const item of value) {
    if (
      item !== null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).gid === "string" &&
      typeof (item as Record<string, unknown>).name === "string"
    ) {
      result.push({
        gid: (item as Record<string, unknown>).gid as string,
        name: (item as Record<string, unknown>).name as string,
      });
    }
  }
  return result;
}

const assignTool: ViewTool<AssignArgs, AssignOut> = {
  descriptor: assignDescriptor,
  async handle(args: AssignArgs, _ctx: ViewToolContext) {
    const out: AssignOut = {
      task_gid: typeof args.task_gid === "string" ? args.task_gid : "",
      task_url: typeof args.task_url === "string" ? args.task_url : "",
      task_title: typeof args.task_title === "string" ? args.task_title : "",
      current_assignee:
        typeof args.current_assignee === "string" ? args.current_assignee : "",
      candidate_assignees: safeAssignees(args.candidate_assignees),
      note_body: typeof args.note_body === "string" ? args.note_body : "",
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Asana task assign UI") }],
      structuredContent: out,
    };
  },
};

// ---------------------------------------------------------------------------
// 4. create — "Create a follow-up task"
// ---------------------------------------------------------------------------

interface Project {
  gid: string;
  name: string;
}

interface CreateArgs {
  parent_task_title?: string;
  draft_name?: string;
  candidate_assignees?: Assignee[];
  due_on?: string;
  candidate_projects?: Project[];
}

interface CreateOut {
  parent_task_title: string;
  draft_name: string;
  candidate_assignees: Assignee[];
  due_on: string;
  candidate_projects: Project[];
}

const createDescriptor: ViewToolDescriptor = {
  name: "agntux_asana_create",
  description:
    "Renders an inline iframe to create a follow-up Asana task, with assignee, due date, and project selection.",
  inputSchema: {
    type: "object",
    properties: {
      parent_task_title: {
        type: "string",
        description: "Title of the task this follow-up is created from.",
      },
      draft_name: { type: "string", description: "Pre-drafted name for the new task." },
      candidate_assignees: {
        type: "array",
        items: {
          type: "object",
          properties: {
            gid: { type: "string" },
            name: { type: "string" },
          },
          required: ["gid", "name"],
        },
      },
      due_on: { type: "string", description: "Suggested due date (YYYY-MM-DD)." },
      candidate_projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            gid: { type: "string" },
            name: { type: "string" },
          },
          required: ["gid", "name"],
        },
      },
    },
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
            name: { type: "string" },
          },
        },
      },
      due_on: { type: "string" },
      candidate_projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            gid: { type: "string" },
            name: { type: "string" },
          },
        },
      },
    },
    required: ["parent_task_title", "draft_name", "candidate_assignees", "due_on", "candidate_projects"],
  },
  ui_resource_uri: "ui://agntux-asana/create",
  data_paths: [{ pattern: "actions/{gid}-asana-task.md", scope: "personal" }],
};

function safeProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return [];
  const result: Project[] = [];
  for (const item of value) {
    if (
      item !== null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).gid === "string" &&
      typeof (item as Record<string, unknown>).name === "string"
    ) {
      result.push({
        gid: (item as Record<string, unknown>).gid as string,
        name: (item as Record<string, unknown>).name as string,
      });
    }
  }
  return result;
}

const createTool: ViewTool<CreateArgs, CreateOut> = {
  descriptor: createDescriptor,
  async handle(args: CreateArgs, _ctx: ViewToolContext) {
    const out: CreateOut = {
      parent_task_title:
        typeof args.parent_task_title === "string" ? args.parent_task_title : "",
      draft_name: typeof args.draft_name === "string" ? args.draft_name : "",
      candidate_assignees: safeAssignees(args.candidate_assignees),
      due_on: typeof args.due_on === "string" ? args.due_on : "",
      candidate_projects: safeProjects(args.candidate_projects),
    };
    return {
      content: [{ type: "text", text: renderConfirmationText("Asana create task UI") }],
      structuredContent: out,
    };
  },
};

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

// Suppress unused-variable warning on the placeholder helper
void placeholderTask;

export default {
  viewTools: [commentTool, completeTool, assignTool, createTool],
};

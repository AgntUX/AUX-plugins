# AgntUX data access — where the knowledge store lives and how to read it

AgntUX maintains a **personal knowledge store** on the user's disk: a
synthesized, human-readable record of the people, projects, threads, and
action items distilled from their connected sources (Slack, Gmail, Google
Calendar, …). The Sentry surface reads this store to
**personalize** what it does — resolving who "Dana" is, which calendar to
use, what a thread was about — and writes back only through the sync pass
and click-time iframe envelopes. It never invents data: if the store does
not have a fact, say so rather than guessing.

Any interactive lane that personalizes from the store (resolving
names → emails, reading the user's timezone, citing prior context) MUST
run the access preflight below **before** its first read of
`<agntux project root>`. Do NOT blind-scan the filesystem (`find /`,
home-directory globs) to locate the data — resolve the root, connect it
if needed, then read the known paths.

## 1. Resolve the project root

<!-- canonical-mirror: agntux-core/skills/_resolve-root.md -->

The AgntUX project is any directory named `agntux` (case-insensitive).
Resolve `<agntux project root>` via this ladder; stop at the first match,
and **canonicalise to an absolute path** (expand `~`, drop `./`/`..`)
before using it in any tool call:

1. `basename(cwd).toLowerCase() === "agntux"` → use cwd silently.
2. Any ancestor of cwd is named `agntux` → use the nearest; emit one line:
   "Working in the agntux project at `{root}`."
3. `~/agntux/` exists and is a directory → use it (resolve `~` to the
   absolute home path, e.g. `/Users/<you>/agntux`); emit one line:
   "Using your AgntUX project at `/Users/<you>/agntux`."
4. None of the above → this is an interactive lane, so ask once, verbatim:
   "I don't see an AgntUX project yet. Want me to set one up at `~/agntux`
   now? (yes / no)" — **yes** → invoke `/agntux onboard` (it owns the
   create-and-connect flow) and stop; **no / anything else / no response**
   → reply "Okay — let me know when you're ready." and stop. (If this lane
   is firing as a scheduled task with no user present, skip the question
   and exit cleanly.)

## 2. Connect the directory if it is not readable

The resolved root may not be directly readable by Read / Glob / Grep —
in Cowork the user's folder is not mounted into the host filesystem until
it is connected. If a Read or Glob under `<agntux project root>` returns
not-found for a path you expect to exist, **connect the folder before
giving up** (never ask the user to run a terminal command):

- `ToolSearch({ query: "select:mcp__cowork__request_cowork_directory", max_results: 1 })`.
- If it resolves, call it with `{ path: "<absolute project root>" }`. On
  approval the host re-points the working directory — re-read on the next
  turn. On decline, tell the user they can select the folder in the
  project picker and re-run, then stop.
- If it does NOT resolve (non-Cowork host) the path is simply absent —
  tell the user where you looked and ask them to open / select that
  folder, then stop.

## 3. Data layout — where to read

Once the root is readable these are the paths (read-only from any
interactive lane). **Entities and actions live at the TOP level — NOT
under `data/`.**

```
<agntux project root>/
  user.md                         # the user: identity, timezone, working hours, email
  entities/
    _index.md  _sources.json      # owned by agntux-core hooks — never edit
    person/{slug}.md              # people (name, aliases, role, sources, sometimes email)
    {subtype}/{slug}.md           # other entity subtypes
  actions/
    _index.md                     # owned by agntux-core hooks
    {action-id}.md                # action items — frequently carry emails / attendees
  digests/                        # rolled-up summaries
  data/
    schema/                       # entity / action vocabulary (schema_version)
    instructions/{plugin}.md      # per-plugin always / never-raise rules
    learnings/  sync-state/       # feedback patterns; per-source cursors
```

## 4. Resolve a person → contact detail (good-UX recipe)

When a request names people ("schedule with Dana and Yousef", "reply to
the thread with Priya"), resolve them from the store instead of asking the
user to retype what AgntUX already knows:

1. Match each name / alias against `entities/person/{slug}.md` (check the
   `name:` and `aliases:` frontmatter).
2. Prefer a contact detail already on the entity (e.g. an `email:` field).
3. If the entity has no email, grep the ~30 most-recent `actions/*.md` (by
   date-prefixed filename) for an `@`-address near the person's name — action
   bodies and frontmatter frequently mention attendee emails (calendar-sourced
   actions in particular carry attendee / participant addresses).
4. If still unresolved, keep the display name and leave the address for the
   user to fill in — **never invent an address.**

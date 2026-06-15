### Step 10.1c — Canvas payload section (slack)

Beyond `## Compose payload`, this plugin's canvas summariser view reads a
dedicated payload section; omit it and the canvas view renders "Canvas summary
not available":

- **Conditional body section: `## Canvas payload`** — REQUIRED for every action
  item that ships a "Summarise the thread" / canvas suggested action; the canvas
  view reads it. Schema and YAML quoting rules are defined by the canvas-payload
  reference shape.

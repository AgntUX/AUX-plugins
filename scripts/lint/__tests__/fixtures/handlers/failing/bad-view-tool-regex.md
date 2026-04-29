---
name: test-handler
description: Handler with a view_tool that does not end in _view.

operational:
  verb_phrases:
    - "display the test UI for {ref}"
  view_tool: TestItemView
  resource_uri: "ui://test-item"
  structured_content_schema:
    - item_id
  follow_up_intents: []
  degraded_states:
    source_not_found:
      ui: "no-render"
      action: "Item not found."
---

# Bad view_tool regex

view_tool "TestItemView" does not match ^[a-z][a-z0-9_]*_view$ (uppercase letters, no trailing _view suffix).

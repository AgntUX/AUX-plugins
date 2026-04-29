---
name: test-handler
description: Handler missing view_tool.

operational:
  verb_phrases:
    - "display the test UI for {ref}"
  resource_uri: "ui://test-item"
  structured_content_schema:
    - item_id
  follow_up_intents: []
  degraded_states:
    source_not_found:
      ui: "no-render"
      action: "Item not found."
---

# Missing view_tool

This handler has an operational block but is missing the required view_tool field.

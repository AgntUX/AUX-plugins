---
name: test-handler
description: Handler missing verb_phrases.

operational:
  view_tool: test_item_view
  resource_uri: "ui://test-item"
  structured_content_schema:
    - item_id
  follow_up_intents: []
  degraded_states:
    source_not_found:
      ui: "no-render"
      action: "Item not found."
---

# Missing verb_phrases

This handler has an operational block but is missing the required verb_phrases field.

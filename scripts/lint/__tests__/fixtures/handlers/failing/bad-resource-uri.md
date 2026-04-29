---
name: test-handler
description: Handler with a resource_uri that does not start with ui://.

operational:
  verb_phrases:
    - "display the test UI for {ref}"
  view_tool: test_item_view
  resource_uri: "https://example.com/test-item"
  structured_content_schema:
    - item_id
  follow_up_intents: []
  degraded_states:
    source_not_found:
      ui: "no-render"
      action: "Item not found."
---

# Bad resource_uri

resource_uri starts with "https://" instead of the required "ui://".

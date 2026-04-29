---
name: test-handler
description: A fully valid handler for testing Pass 6.
tools: Read, mcp__test-plugin__*, mcp__test-plugin-ui__*

operational:
  catalogue_version: "1.0"
  verb_phrases:
    - "display the test UI for {ref}"
    - "show test view for {ref}"
  view_tool: test_item_view
  resource_uri: "ui://test-item"
  structured_content_schema:
    - item_id
    - item_title
    - item_body
  follow_up_intents:
    - send-test-reply
  degraded_states:
    source_not_found:
      ui: "no-render"
      action: "Surface 'Item not found'; offer mark-done button."
    source_auth_failed:
      ui: "no-render"
      action: "Surface 'Auth failed — check your connection'."
---

# Test handler

A valid handler used as a passing fixture for the Pass 6 unit tests.

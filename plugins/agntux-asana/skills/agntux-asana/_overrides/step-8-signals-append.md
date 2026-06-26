**Asana-specific raise signals:**

- Task assigned to the user with `due_on` within 7 days → lean raise.
- Task that was previously unassigned and is now assigned to the user
  this run → raise (new assignment).
- Comment/story where the author's `email` matches the user's email in
  `user.md → # Identity` is the user themselves → suppress for
  response-needed triage (the user wrote it; they don't need to respond
  to themselves).
- Comment that mentions the user by `@name` (match against `user.md →
  # Identity` display name or email prefix) → raise `response-needed`.
- Project status update where the status changed to `off_track` or
  `at_risk` for a project the user is a member of → raise.
- Task completed by someone other than the user (status transitioned
  to `completed: true` this window) → suppress unless the task was
  blocking a deadline; quietly update the entity `## Recent signals`.

**Suppress signals (Asana-specific):**

- System stories (`type: system` — task created, assigned, moved) →
  suppress; these are state transitions, not human communication.
- Tasks completed more than 7 days ago (already outside the action
  horizon) → suppress.
- Tasks in projects the user is only a guest of with no direct
  assignment or mention → low-confidence; suppress unless heuristic 6
  applies.

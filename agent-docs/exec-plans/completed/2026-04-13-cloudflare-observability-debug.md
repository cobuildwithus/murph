## Goal

Enable temporary full Cloudflare observability for hosted execution so worker and Durable Object failures produce stored dashboard events instead of metrics-only error counts.

## Constraints

- Preserve unrelated in-progress work already registered in the coordination ledger.
- Keep the change scoped to `apps/cloudflare` observability config, deploy automation defaults, docs, and focused tests.
- Use a temporary debug posture that can be reverted cleanly after incident diagnosis.

## Plan

1. Set the checked-in Wrangler scaffold and deploy automation defaults to explicit full log and trace persistence.
2. Update focused tests and deploy docs to match the temporary debug posture.
3. Run the focused Cloudflare verification lane and commit only the observability-debug files.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13

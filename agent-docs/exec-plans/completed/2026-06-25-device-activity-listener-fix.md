Goal (incl. success criteria):
- Fix deviceActivity automations so the durable listener remains a listener and each matching activity creates a separate one-shot delivery occurrence.
- Success means a matching activity queues assistant delivery without rewriting the canonical automation to an `at` schedule, listener cursors advance only after occurrence enqueue, multiple matching activities in one pass are queued, and require-send behavior still applies to the queued occurrence.

Constraints/Assumptions:
- Keep the change scoped to assistant cron/device-activity handoff and the shared cron job contract needed by that handoff.
- Prefer existing local cron primitives over a new delivery system or persisted product state.
- Preserve canonical automation ownership in core; use patching only to advance the listener cursor.
- Preserve unrelated active ledger rows and avoid other worktree lanes.

Key decisions:
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Represent listener-triggered sends as deterministic local cron jobs keyed by listener id, activity id, and trigger timestamp.
- Keep `system:assistant-require-send` on the local job metadata so cron execution can enforce send-required policy.

State:
- Ready to commit; implementation and scoped verification are complete.

Done:
- Read repo workflow, architecture, device-sync, ingestion invariant, and supplied patch context.
- Created isolated task branch/worktree from `origin/main`.
- Implemented deterministic local cron occurrences for device activity listener matches while preserving the canonical listener schedule.
- Added regression coverage for multi-activity queueing, listener cursor advancement, local require-send wake detection, and no canonical cron projection.
- Passed focused assistant-engine tests, root typecheck, runtime artifact prep, assistant-runtime package build, and scoped diff-aware verification.

Now:
- Commit and open the PR.

Next:
- Push the branch, open the PR, and run the PR ReviewGPT loop to zero accepted findings.

Open questions (UNCONFIRMED if needed):
- None currently.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/device-activity-automations.ts
- packages/assistant-engine/src/assistant/cron/execution.ts
- packages/operator-config/src/assistant-cli-contracts.ts
- packages/assistant-engine/test/device-activity-automations.test.ts
- pnpm typecheck
- pnpm test:diff packages/assistant-engine/src/assistant/device-activity-automations.ts packages/assistant-engine/src/assistant/cron/execution.ts packages/operator-config/src/assistant-cli-contracts.ts packages/assistant-engine/test/device-activity-automations.test.ts
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25

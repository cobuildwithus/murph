Goal (incl. success criteria):
- Resolve the ReviewGPT findings against the hosted mailbox follow-up fix cleanly.
- Success means mailbox consume ack is anchored to a server-provided consumed floor, terminal-skip-only batches can advance without a reply outcome while mixed assistant coverage still cannot, and incomplete pending-input indexes fail closed until fully backfilled.
- Prove the rapid follow-up/local replay path with focused regressions and a local hosted runtime scenario.

Constraints/Assumptions:
- Web owns mailbox rows, lane counters, and consumed_seq.
- Assistant runtime may consume only a contiguous, server-anchored proof after durable local state is safe.
- Keep compatibility narrow and temporary; do not add another queue, scheduler, or broad state owner.
- Preserve unrelated worktree edits and existing active ledger rows.

Key decisions:
- Treat missing server consumed metadata as ineligible for consume instead of guessing from local imported watermarks.
- Let terminal_skip coverage acknowledge only when the prefix has no assistant-input coverage.
- Use pending-input index completeness as part of the consume gate; missing or unbackfilled state must trigger full compaction/backfill before consume.
- Use the same replay-aware mailbox budget predicate for initial and active-turn imports; already-imported or durably-consumed replay rows must not spend the fresh-work import budget.
- Keep local replay handling inside the mailbox import loop. Rows already covered by the restored local watermark produce contiguous terminal coverage without resolving old payload sidecars or re-entering importer callbacks.
- Flush replay-only consume acks in the no-dirty return path because the restored workspace checkpoint is already the durable boundary.

State:
- Done; verification passed.

Done:
- ReviewGPT findings received and scoped.
- Prior branch commit exists with the initial replay/import fixes.
- Confirmed the pasted ReviewGPT findings are covered in current branch tests.
- Found and fixed a sibling initial-import budget bug that could strand a fresh tail behind a large replay prefix.
- Added regression coverage for server consumed 0, restored local watermark 250, 100 replay rows, and fresh seq 251 under `maxMailboxItems: 2`.
- Added regression coverage for stale sidecar replay rows not blocking fresh seq 251.
- Added entrypoint coverage for replay-only consume ack flushing without a synthetic workspace checkpoint.

Now:
- Commit and push the scoped branch update.

Next:
- Open/update PR and run ReviewGPT.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-mailbox/store.ts
- apps/web/test/hosted-mailbox-store.test.ts
- packages/assistant-runtime/src/hosted-runtime.ts
- packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts
- packages/assistant-runtime/src/hosted-runtime/pending-assistant-input.ts
- packages/assistant-runtime/src/hosted-runtime/pending-input-index.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts
- packages/assistant-runtime/test/hosted-runtime-mailbox-import.test.ts
- packages/assistant-runtime/test/hosted-runtime-pending-assistant-input.test.ts
- packages/assistant-runtime/test/hosted-runtime-pending-input-index.test.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18

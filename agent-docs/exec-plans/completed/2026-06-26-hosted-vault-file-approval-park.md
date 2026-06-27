Goal (incl. success criteria):
- Fix hosted outbox vault-file intents so a missing hosted action-approval boundary parks the intent durably during collection instead of only skipping it in memory.
- Success means a due/preferred hosted Linq vault-file outbox intent with no approval metadata and no action-approval port is persisted as awaiting approval with a bounded retry timestamp, and the outbox next wake is no longer immediate.

Constraints/Assumptions:
- Assistant runtime owns outbox truth and next-wake projection inside the restored hosted workspace.
- Missing action-approval authority must fail closed into durable owner state; do not add a scheduler, queue, or web-control fallback.
- Preserve existing outbox dispatch preflight behavior and avoid broad refactors.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Reuse the existing `deferAssistantVaultFileApprovalCheck` durable parking path from dispatch preflight.
- Remove the collection-only in-memory skip for due/preferred vault-file approval reconciliation.
- Add a focused hosted-runtime callback regression for the production-faithful path described in the review.

State:
- Ready to commit.

Done:
- Confirmed PR #321 is merged and the finding applies to current `origin/main`.
- Created an isolated task worktree from current `origin/main`.
- Changed collection-time vault-file approval reconciliation to use durable blocking when the action-approval port is missing.
- Added a hosted-runtime callback regression covering the preferred/due Linq vault-file intent path and next-wake projection.
- Ran focused runtime tests, prepared workspace build artifacts for typecheck, full typecheck, and scoped diff verification.

Now:
- Commit the scoped fix and open the follow-up PR.

Next:
- Push the branch and hand off with PR, verification, and deployment notes.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/callbacks.ts
- packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts
- packages/assistant-engine/src/assistant/vault-file-send.ts
- PR #321 review finding at commit `4c2699a5528ba27251c86d1577df6c1679a710cf`
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26

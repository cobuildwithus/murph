Goal (incl. success criteria):
- Add a deterministic assistant automation guard that hard-skips stale scheduled wakes more than 30 minutes past their intended run time.
- Cover recurring local-time reminders as well as existing one-shot notification expiry so late hosted wake/orchestration catch-up cannot deliver old reminders.
- Success means stale due automations are skipped, their schedule advances normally, no assistant/provider turn starts for skipped wakes, and focused tests prove the behavior.

Constraints/Assumptions:
- Keep the fix inside assistant automation runtime ownership; do not add a new scheduler, queue, persisted table, or prompt-level policy.
- Preserve recurring automation semantics for non-stale due runs.
- Keep logs/diagnostics metadata-only and avoid direct personal identifiers.
- Preserve unrelated worktree and ledger rows.

Key decisions:
- Fold the stale check into `executeClaimedAssistantCronJob` (gated on the `scheduled` trigger) instead of keeping a parallel expire path, so claim -> execute -> finalize is the single wake pipeline and the previous `expireNextStaleDueAssistantCronJob` duplicate finalization path is deleted.
- A stale skip consumes its occurrence like a success (one shared `assistantCronRunConsumedOccurrence` predicate) so one-shots archive and recurring schedules advance with no new state path; manual run-now is exempt and always executes.
- Treat the 30 minute threshold as the existing product stale-send window; one expiry message for all notification kinds.
- Accepted gap: legacy local-store jobs anchor staleness on `nextRunAt`, which failure backoff resets, so locally retried sends can outlive the window. New jobs are canonical-only (covered via `pendingOccurrenceAt`); the durable fix is deleting the legacy local store, not adding occurrence state to it.

State:
- Verification complete; final review/PR handoff pending.

Done:
- Production diagnosis showed the stale one-shot guard did not cover `dailyLocal` recurring reminders.
- Added the 30 minute stale notification guard inside claimed cron execution for one-shot, kept one-shot, and recurring notification jobs; scheduled-log jobs stay exempt.
- Deleted the separate `expireNextStaleDueAssistantCronJob` path so stale wakes reuse the normal claim/execute/finalize pipeline and run finalizers.
- Added canonical, canonical retry, local recurring, and kept one-shot stale-skip regressions.
- Verified with focused assistant cron tests, workspace typecheck, and diff-scoped affected package/app verification.

Now:
- Run final review, commit, push, and open the PR.

Next:
- Resolve any final review findings, then finish the active plan.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/cron/execution.ts
- packages/assistant-engine/test/assistant-cron-runtime.test.ts
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09

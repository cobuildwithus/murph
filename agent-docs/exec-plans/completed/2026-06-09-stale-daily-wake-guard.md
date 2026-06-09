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
- Prefer one shared stale-wake predicate around claimed cron execution over broader orchestration changes.
- Treat the 30 minute threshold as the existing product stale-send window.

State:
- Verification complete; final review/PR handoff pending.

Done:
- Production diagnosis showed the stale one-shot guard did not cover `dailyLocal` recurring reminders.
- Added the 30 minute stale notification guard at the cron wake level for one-shot and recurring notification jobs.
- Reused the existing run finalizers so a stale skip consumes the occurrence and advances recurring schedules without adding another state path.
- Added canonical, canonical retry, and local recurring stale-skip regressions.
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

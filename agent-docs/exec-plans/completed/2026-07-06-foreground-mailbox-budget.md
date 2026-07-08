Goal (incl. success criteria):
- Fix hosted runtime foreground mailbox handling so system mailbox churn cannot exhaust the foreground conversation import budget and delay user replies.
- Success is a focused regression test where system foreground wakes exhaust the normal mailbox budget but a later conversation wake still imports and stages promptly.

Constraints/Assumptions:
- Preserve foreground reply priority over browser-vault refresh, device sync, maintenance, and idle checkpoint work.
- Keep web-owned mailbox ordering and runtime-owned local import/checkpoint boundaries unchanged.
- No new scheduler, queue, persisted state, or broad runtime lifecycle abstraction.
- Do not alter unrelated active mailbox consumed-at work.

Key decisions:
- Reserve the foreground mailbox budget for conversation-lane items during the active foreground import loop.
- Let system-lane items imported opportunistically by that loop use the normal runtime mailbox import path/budget.

State:
- Done.

Done:
- Reproduced local symptom from logs/DB: accepted Telegram follow-up waited for later stale-runtime replacement after an active foreground import hit `budget.mailbox_items`.
- Patched active foreground import routing so the foreground budget applies only to conversation-lane items.
- Added a regression test covering system foreground churn before a later conversation wake.
- Verified focused regression, affected runner tests, full entrypoint tests, package typecheck, and scoped workspace diff verification.

Now:
- Ready to close the plan and commit the scoped changes.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- Whether broader active-system import behavior needs a follow-up design pass after this narrow starvation fix.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06

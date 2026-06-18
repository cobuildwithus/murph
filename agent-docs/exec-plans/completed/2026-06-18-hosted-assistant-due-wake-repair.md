Goal (incl. success criteria):
- Prevent due hosted assistant cron jobs from being masked by system-mailbox, device-sync, or other background-only maintenance lanes.
- Keep the fix simple: derive wake intent from assistant-owned cron state, avoid a new scheduler/table, and do not add foreground hot-path reads.
- Success means due cron runs the assistant lane immediately, background-only wake selection preserves future cron wakes, remaining due cron after bounded background catch-up re-arms an immediate wake, and focused tests cover those paths.

Constraints/Assumptions:
- Assistant cron state remains the durable source of truth for scheduled reminders.
- Temporal remains pointer/timer orchestration, not a second scheduler.
- Background/system maintenance may merge assistant wake candidates but must not own reminder truth.
- Preserve unrelated working-tree edits and active ledger rows.

Key decisions:
- Use one due-aware assistant cron wake helper instead of adding more system-lane special cases.
- Treat due cron as a reason to run the assistant lane, not as a future-only wake candidate.
- Bound hosted background automation scans and rely on immediate re-arm when more due work remains.

State:
- Complete; pending scoped finish-task commit.

Done:
- Diagnosed missed reminder as a due assistant cron wake being dropped by future-only normalization while a background/system lane occupied the wake path.
- Implemented due-aware assistant cron wake reconciliation without a new scheduler/table.
- Kept cron-status reads off fresh-input foreground setup and made background system-maintenance cron reads lazy/memoized.
- Bounded hosted background automation scans to one item per pass and re-armed immediate wake when that cap leaves more work.
- Added focused due-wake, post-delivery re-arm, and capped-backlog regressions.
- Ran required verification and completion audits.

Now:
- Close plan and create scoped commit.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-runtime/src/hosted-runtime/maintenance.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts
- packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts
- pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-maintenance.test.ts
- pnpm --dir packages/assistant-runtime typecheck
- pnpm test:diff packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts
- pnpm typecheck
- pnpm test:smoke
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17

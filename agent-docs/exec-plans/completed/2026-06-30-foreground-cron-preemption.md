Goal (incl. success criteria):
- Prove and fix the hosted Linq scheduled-reminder overlap where background cron can send before a foreground user reply when inbound foreground work is already observed.
- Success means a hosted-local Linq scheduled-reminder E2E covers the overlap and passes with foreground reply priority preserved.

Constraints/Assumptions:
- Preserve the hosted foreground-priority invariant without adding a new scheduler, queue, or durable owner.
- Keep reminder sends on the existing assistant cron and outbox lanes.
- Do not touch unrelated active hosted-runtime work.

Key decisions:
- Reuse the existing hosted-local Linq scheduled-reminder E2E instead of adding a separate harness.
- Thread the existing workspace runner background-yield signal into the automation loop before cron execution.

State:
- Complete; ready to archive after commit.

Done:
- Production trace and code inspection identified cron execution as missing the foreground-yield hook.
- Added a hosted-local E2E overlap regression that drives production-style ensure-processing, posts a foreground Linq inbound while reminder cron is entering automation, and asserts the foreground assistant request/reply is first.
- Threaded the workspace runner foreground runtime-wake signal into hosted assistant automation cron deferral before due jobs are processed.
- Verified assistant-engine automation tests, assistant-runtime hosted-runtime tests, the hosted-local Linq scheduled-reminder E2E, full workspace typecheck, and diff hygiene.

Now:
- Archive the plan and commit the scoped fix.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts
- packages/assistant-engine/src/assistant/automation/run-loop.ts
- packages/assistant-runtime/src/hosted-runtime/maintenance.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts
- pnpm hosted-local e2e linq-scheduled-reminder
- pnpm --dir packages/assistant-engine test -- assistant-automation-runtime.test.ts
- pnpm --dir packages/assistant-runtime test -- hosted-runtime-environment.test.ts hosted-runtime-workspace-runner.test.ts hosted-runtime-maintenance.test.ts
- pnpm typecheck
- git diff --check
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01

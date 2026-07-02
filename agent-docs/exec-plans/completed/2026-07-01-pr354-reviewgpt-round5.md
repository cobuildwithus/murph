# PR 354 ReviewGPT Round 5 Fixes

Goal (incl. success criteria):
- Resolve ReviewGPT round 5 findings for PR 354 while reducing foreground
  preemption ownership split where feasible.
- Success means accepted findings are fixed with focused regressions, local
  verification passes, the PR head is pushed, ReviewGPT reaches zero accepted
  findings, and PR CI is green.

Constraints/Assumptions:
- Fresh foreground conversation input remains higher priority than background
  outbox delivery, provider cleanup, scheduled logs, and queue-only cron
  delivery.
- ReviewGPT artifacts under `audit-packages/` stay uncommitted.
- Prefer targeted collapse of existing guards over adding new independent
  background-preemption concepts.

Key decisions:
- Treat the non-foreground post-checkpoint drain and scheduled-log preemption
  findings as accepted.

State:
- Local verification passed; ready to commit and push.

Done:
- ReviewGPT round 5 completed on pushed PR head `f91d26f` with CI green.
- Added the missing non-foreground assistant post-checkpoint foreground import
  loop flag and repeated yield checks around the background delivery drain.
- Added scheduled-log cron foreground guards before execution, before the core
  event write, and before marking the cron run successful.
- Added focused regressions for post-barrier background delivery yield and
  scheduled-log foreground yield before event write.
- Verification passed:
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-assistant-phase.test.ts`
  - `pnpm --dir packages/assistant-engine test -- assistant-cron-runtime.test.ts`
  - `pnpm --dir packages/assistant-engine test -- assistant-notification-turn-runtime.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-runner.test.ts hosted-runtime-workspace-entrypoint.test.ts`
  - `pnpm --dir packages/core test -- scheduled-logs`
  - `pnpm typecheck`
  - `pnpm hosted-local e2e linq-scheduled-reminder`
  - `git diff --check`

Now:
- Commit and push the round 5 fixes.

Next:
- Rerun ReviewGPT, then wait for ReviewGPT and PR CI to be green.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts
- packages/assistant-engine/src/assistant/cron/execution.ts
- packages/assistant-engine/src/assistant/cron/scheduled-log.ts
- packages/assistant-engine/test/assistant-cron-runtime.test.ts
- packages/core/src/scheduled-logs.ts
- audit-packages/pr-354-round-5.md
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01

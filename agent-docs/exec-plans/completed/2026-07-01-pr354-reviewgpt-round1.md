# PR 354 ReviewGPT Round 1 Fixes

Goal (incl. success criteria):
- Resolve PR 354 ReviewGPT round 1 blockers so hosted cron foreground preemption is real during in-flight cron execution and the regression proof does not rely on production-only test-delay code.
- Success means the focused unit/integration tests, hosted-local Linq scheduled-reminder E2E, typecheck, PR CI, and a follow-up ReviewGPT round all pass with zero accepted findings.

Constraints/Assumptions:
- Preserve the existing hosted assistant cron/outbox ownership; do not add a new scheduler, queue, lifecycle enum, or durable state owner.
- Keep foreground conversation work higher priority than idle/background maintenance.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

Key decisions:
- Accept both ReviewGPT round 1 findings as real.
- Move deterministic overlap proof into the hosted-local provider/test harness instead of production runtime delay branches.

State:
- Local fixes verified; ready to commit and push for ReviewGPT round 2 plus PR CI.

Done:
- ReviewGPT round 1 completed on pushed PR head `f45df18` and returned two accepted blockers.
- Removed the hosted-local cron pre-defer test env branch from production runtime and launch-spec forwarding.
- Threaded foreground-yield checks from hosted automation into cron scan, claim, execution, provider abort, notification pre-delivery, and outbox dispatch.
- Added deterministic hosted-local provider hold hooks so the Linq scheduled-reminder E2E proves foreground input overtakes an in-flight reminder without production test sleeps.
- Added focused regressions for pre-claim cron yield, in-flight canonical cron yield, and notification abort before outbound delivery.
- Verified:
  - `pnpm --dir packages/assistant-engine test -- assistant-cron-runtime.test.ts assistant-automation-runtime.test.ts assistant-notification-turn-runtime.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-environment.test.ts hosted-runtime-workspace-runner.test.ts hosted-runtime-maintenance.test.ts`
  - `pnpm hosted-local e2e linq-scheduled-reminder`
  - `pnpm typecheck`
  - `git diff --check`
  - sensitive/raw diff scan

Now:
- Commit and push the scoped PR feedback fix.

Next:
- Rerun ReviewGPT on the pushed PR head and wait for PR CI to be green.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/automation/run-loop.ts
- packages/assistant-engine/src/assistant/cron.ts
- packages/assistant-engine/src/assistant/cron/execution.ts
- packages/assistant-engine/src/assistant/notification-turn.ts
- packages/assistant-engine/src/assistant/outbox.ts
- packages/assistant-engine/test/assistant-automation-runtime.test.ts
- packages/assistant-engine/test/assistant-cron-runtime.test.ts
- packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts
- packages/assistant-runtime/src/hosted-runtime/launch-spec.ts
- packages/assistant-runtime/test/hosted-runtime-environment.test.ts
- apps/cloudflare/test/helpers/hosted-local-e2e-support.ts
- apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts
- audit-packages/pr-354-round-1.md
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01

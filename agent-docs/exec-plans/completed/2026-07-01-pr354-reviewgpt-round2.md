# PR 354 ReviewGPT Round 2 Fixes

Goal (incl. success criteria):
- Resolve ReviewGPT round 2 findings for PR 354 without adding new schedulers, queues, durable state owners, or broad lifecycle machinery.
- Success means accepted findings are fixed with focused regressions, local verification passes, the PR head is pushed, ReviewGPT reaches zero accepted findings, and PR CI is green.

Constraints/Assumptions:
- Foreground conversation work stays higher priority than hosted cron/background work.
- Generic runtime wakes are not proof of foreground conversation input.
- Queue-only outbox acceptance is not user-visible delivery.
- Hosted-local test flags belong in test/harness composition unless production runtime genuinely owns them.
- ReviewGPT artifacts under `audit-packages/` stay uncommitted.

Key decisions:
- Treat all three ReviewGPT round 2 findings as plausible pending code-path inspection.
- Generic runtime wakes should not latch foreground preemption until mailbox import
  proves conversation work.
- Queue-only cron delivery is still preemptible until the queued outbox intent
  leaves the pre-dispatch states.
- `MURPH_HOSTED_LOCAL_TEST_ROUTES` remains harness/worker-owned and is not
  forwarded into assistant runtime env profiles.

State:
- Local fixes and verification complete; ready to commit, push, rerun ReviewGPT,
  and wait for PR checks.

Done:
- ReviewGPT round 2 completed on pushed PR head `dc8092787a` with three findings.
- Removed runtime-wake-only foreground preemption.
- Added runtime regressions for generic wakes and late-import foreground proof.
- Added queue-only cron regression that abandons a queued outbox intent on
  foreground yield before dispatch.
- Removed hosted-local test route forwarding from the assistant runtime env
  profile and updated env-profile expectations.
- Verification passed:
  - `pnpm --dir packages/assistant-engine test -- assistant-cron-runtime.test.ts assistant-notification-turn-runtime.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-environment.test.ts hosted-runtime-workspace-runner.test.ts hosted-runtime-maintenance.test.ts`
  - `pnpm hosted-local e2e linq-scheduled-reminder`
  - `pnpm typecheck`
  - `git diff --check`

Now:
- Commit and push the scoped round-2 fix.

Next:
- Rerun ReviewGPT and wait for GitHub checks to turn green.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts
- packages/assistant-runtime/src/hosted-runtime/maintenance.ts
- packages/assistant-runtime/src/hosted-runtime/launch-spec.ts
- packages/assistant-runtime/test/hosted-runtime-environment.test.ts
- packages/assistant-engine/src/assistant/automation/run-loop.ts
- packages/assistant-engine/src/assistant/cron/execution.ts
- packages/assistant-engine/src/assistant/outbox.ts
- packages/assistant-engine/src/assistant/outbox/dispatch-state.ts
- packages/assistant-engine/test/assistant-cron-runtime.test.ts
- packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts
- apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts
- audit-packages/pr-354-round-2.md
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01

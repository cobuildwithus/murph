# PR 354 ReviewGPT Round 4 Fixes

Goal (incl. success criteria):
- Resolve ReviewGPT round 4 findings for PR 354 without adding broad runtime
  machinery or new persisted state owners.
- Success means the accepted findings are fixed with focused regressions, local
  verification passes, the PR head is pushed, ReviewGPT reaches zero accepted
  findings, and PR CI is green.

Constraints/Assumptions:
- Fresh foreground conversation input remains higher priority than background
  outbox delivery, provider cleanup, and queue-only cron delivery.
- ReviewGPT artifacts under `audit-packages/` stay uncommitted.
- Prefer the smallest durable correction over a new scheduler/manager.

Key decisions:
- Treat both round 4 findings as plausible pending code-path inspection.

State:
- Local fixes and verification complete; ready to commit and rerun ReviewGPT/CI.

Done:
- ReviewGPT round 4 completed on pushed PR head `f47b49c` with two high
  findings.
- GitHub checks and Vercel were green for `f47b49c`.
- Added an explicit runner/phase flag so only foreground-preemptible background
  post-checkpoint drains keep the foreground import loop alive.
- Added queued notification abandonment on deferred queue-only commit failure.
- Added regressions for runtime wakes during flagged post-checkpoint work and
  queued notification commit failures.
- Re-ran focused assistant-engine tests, assistant-runtime package tests, full
  typecheck, and hosted-local scheduled-reminder E2E.

Now:
- Commit and push the round-4 fixes.

Next:
- Rerun ReviewGPT and wait for CI.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts
- packages/assistant-engine/src/assistant/notification-turn.ts
- packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts
- audit-packages/pr-354-round-4.md
- `pnpm --dir packages/assistant-engine test -- assistant-notification-turn-runtime.test.ts assistant-cron-runtime.test.ts`
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-runner.test.ts hosted-runtime-workspace-assistant-phase.test.ts hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts -t "runtime wakes pending after checkpoint are drained without a host checkpoint timer"`
- `pnpm typecheck`
- `pnpm hosted-local e2e linq-scheduled-reminder`
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01

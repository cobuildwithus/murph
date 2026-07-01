# PR 354 ReviewGPT Round 6 Fixes

Goal (incl. success criteria):
- Resolve ReviewGPT round 6 findings for PR 354.
- Success means prepared background delivery yields inside the prepared-drain
  loop, queue-only cron does not abandon already committed queued delivery, local
  verification passes, the PR head is pushed, ReviewGPT reaches zero accepted
  findings, and PR CI is green.

Constraints/Assumptions:
- Fresh foreground conversation input remains higher priority than background
  outbox delivery, provider cleanup, scheduled logs, and pre-commit cron
  notification work.
- Once a queue-only cron delivery is durably accepted and the notification turn
  is committed, the cron attempt must consume that accepted side effect instead
  of partially abandoning delivery and retrying.
- ReviewGPT artifacts under `audit-packages/` stay uncommitted.

Key decisions:
- Treat both round 6 high findings as accepted.
- Keep fixes focused on existing foreground-yield and liveness paths; avoid a
  broad preemption abstraction rewrite inside this PR feedback loop.

State:
- Local verification passed; ready to commit and push.

Done:
- ReviewGPT round 6 completed on pushed PR head `fa2821425` with GitHub Actions
  green and Vercel still pending.
- Patched prepared background delivery draining so foreground yield resets
  not-yet-dispatched prepared work inside the drain loop and returns an
  immediate assistant wake.
- Patched queue-only cron so accepted queued delivery remains the consumed side
  effect when foreground yield appears after durable commit.
- Added regressions for prepared-drain in-loop yield, phase-level yielded drain
  handoff, and late queue-only cron foreground yield after queued commit.
- Verification passed:
  - `pnpm --dir packages/assistant-engine test -- assistant-cron-runtime.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-callbacks.test.ts hosted-runtime-workspace-assistant-phase.test.ts`
  - `pnpm --dir packages/assistant-engine test -- assistant-notification-turn-runtime.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-runner.test.ts hosted-runtime-workspace-entrypoint.test.ts`
  - `pnpm typecheck`
  - `pnpm hosted-local e2e linq-scheduled-reminder`
  - `git diff --check`

Now:
- Commit and push the round 6 fixes.

Next:
- Rerun ReviewGPT, then wait for ReviewGPT and PR CI to be green.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-runtime/src/hosted-runtime/callbacks.ts
- packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts
- packages/assistant-engine/src/assistant/cron/execution.ts
- packages/assistant-engine/test/assistant-cron-runtime.test.ts
- audit-packages/pr-354-round-6.md
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01

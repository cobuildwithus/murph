# PR 354 ReviewGPT Round 7 Fix

Goal (incl. success criteria):
- Resolve the ReviewGPT round 7 finding that foreground-yield provider-entry
  exceptions can be persisted as terminal outbox failures.
- Success means pre-provider foreground yield restores prepared work and returns
  yield control flow without entering the generic outbox delivery-failure path,
  local verification passes, the PR head is pushed, ReviewGPT is green, and PR
  CI is green.

Constraints/Assumptions:
- Foreground yield before provider entry should reset/reschedule prepared
  background work.
- After provider entry, outbox owns the delivery attempt through normal
  sent/ambiguous/retry reconciliation.
- ReviewGPT artifacts under `audit-packages/` stay uncommitted.

Key decisions:
- Treat the round 7 high finding as accepted.
- Keep the fix inside hosted-runtime callbacks rather than broadening
  assistant-engine outbox semantics for this PR.

State:
- Local verification passed; ready to commit and push.

Done:
- ReviewGPT round 7 completed on pushed PR head `fbdfb37` with CI green and one
  high accepted finding.
- Moved foreground-yield control flow out of provider dependency exceptions and
  into the pre-`dispatchAssistantOutboxIntent` boundary.
- Added a regression that resets the current prepared background delivery when
  foreground work appears after the outer drain check but before outbox dispatch.
- Verification passed:
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-callbacks.test.ts hosted-runtime-workspace-assistant-phase.test.ts`
  - `pnpm typecheck`
  - `pnpm hosted-local e2e linq-scheduled-reminder`
  - `git diff --check`

Now:
- Commit and push the round 7 fix.

Next:
- Rerun ReviewGPT, then wait for ReviewGPT and PR CI to be green.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/callbacks.ts
- packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts
- audit-packages/pr-354-round-7.md
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01

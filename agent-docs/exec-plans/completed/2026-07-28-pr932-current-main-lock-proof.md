# PR 932 current-main phone-lock proof

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Make the current-main instant-start PostgreSQL concurrency proof follow the
  same participant-phone lock order as production, eliminating its deterministic
  deadlock without changing runtime behavior.

## Proven root cause

- Two exact-head GitHub runs and one isolated local run fail with the same
  PostgreSQL `40P01` cycle.
- The fixture manually writes an uncommitted phone identity without first
  taking the participant-phone advisory lock.
- The admitted planner then holds that lock while waiting on the fixture's
  uncommitted unique identity row, and the fixture asks the same planner for
  the lock before it can commit.
- Production phone-identity creation acquires the participant-phone lock before
  reading or writing identity, so the fixture creates an impossible lock order.

## Work

1. Make the fixture acquire the existing production participant-phone lock
   before writing the uncommitted identity.
2. Prove the exact PostgreSQL suite repeatedly, then run the required canonical
   diff and acceptance checks for the final test-only head.
3. Push the scoped commit, refresh PR evidence, and require green CI while
   leaving PR #932 open and unmerged.

## Constraints

- Test-only correction; do not change the current-main instant-start runtime.
- Reuse the existing lock helper and add no retry, timeout, or synchronization
  machinery.
- Preserve the group-join conflict resolution and its exact-head ReviewGPT
  result.

## Verification

- Before the correction, the exact PostgreSQL suite reproduced the same
  `40P01` deadlock as both GitHub runs: the admitted planner held the
  participant advisory lock while waiting for the fixture's uncommitted
  identity, and the fixture then waited for that advisory lock.
- After the correction, the real-PostgreSQL suite passed three consecutive
  runs, 13 tests each.
- `pnpm test:diff apps/web` passed 556 files with 16 skipped and 7,271 tests
  with 216 skipped. TypeScript, lint (zero errors), development smoke, and the
  production build passed.
- The final local `pnpm verify:acceptance` waited ten continuous minutes for
  the shared host slot and was stopped without signaling its unrelated owner.
- The documented 16-vCPU bounded-admission fallback passed the complete
  canonical acceptance composition in 5m03s on Testbox
  `tbx_01kyn6qmcd21t0cmnm1knh7b6g`; provider run `30396618877` exited
  successfully.
- `git diff --check` and the privacy scan passed before remote verification.
Completed: 2026-07-28

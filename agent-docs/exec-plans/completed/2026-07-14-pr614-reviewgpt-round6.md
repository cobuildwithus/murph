# PR 614 ReviewGPT Round 6

## Goal

Close the exact-head partial-candidate authority gap and make the huge-revision
regression execute the stale-WHOOP completeness boundary it claims to protect.

## Evidence

- ReviewGPT completed a valid Pro-model review of `e00e16f478` with the guarded
  ZIP and `REVIEW_COMPLETE` marker.
- A partial current-ID row can stop the bounded tail inspection without joining
  `matchingStoredDeliveries`; an older full legacy-ID row discovered by full
  inspection can therefore change repair proof while both summary booleans stay
  true.
- The huge-revision test used non-ISO WHOOP versions, so version comparison was
  null and the test did not call the completeness helper.

## Plan

1. Combine supported legacy-ID and historical-partial-row fixtures with a
   distinct-role two-revision partial spine and prove the stale-plan behavior.
2. Rebuild every plan that can write from the authoritative inspection after a
   mandatory full scan; delete the boolean-only authority comparison.
3. Use ordered ISO WHOOP versions and the newer retained row in the huge-
   revision regression so it executes the stale-WHOOP completeness gate.
4. Run focused and full owner verification, required completion audits, close
   the plan, push, and start the next exact-head ReviewGPT round with CI.

## Invariants

- Every committed persistence plan is derived from the authoritative complete
  candidate set at the irreversible write boundary.
- A partial tail candidate cannot hide older full proof or cause an incomplete
  association record to strand accepted history.
- Huge-revision executable proof reaches the exact provider-version branch it
  protects and remains byte-stable and bounded.
- The fix adds no persisted state, dependency, service, queue, or compatibility
  layer.

## Outcome

- Reproduced the partial-current/full-legacy failure: the tail-derived plan
  appended an incomplete association and left the accepted January revision
  missing even after full inspection discovered the older complete proof.
- Every would-write path now rebuilds persistence unconditionally from the
  authoritative full inspection. The boolean-only comparison was deleted.
- Corrected the huge-revision test to use ordered ISO WHOOP versions and retain
  the newer row, so exact replay reaches the stale-WHOOP completeness gate.
- The fix adds no state, service, dependency, or abstraction and slightly
  reduces authority-path complexity.

## Verification

- `pnpm --dir packages/core typecheck` passed.
- `pnpm test:scenario-integrity` passed all 207 scenarios across 11 inputs and
  28 golden directories.
- `pnpm --dir packages/core exec vitest run test/device-import.test.ts` passed
  all 154 tests.
- The focused Round 6 regression pair passed, and the broader authority/replay
  matrix passed all 11 tests.
- `pnpm --dir packages/core test:coverage` passed all 686 tests with 90.18%
  statements, 81.75% branches, 95.49% functions, and 90.24% lines.
- Coverage-write and security/privacy completion audits reported zero
  medium-or-higher findings and made no edits.
- `git diff --check` and scoped identifier/secret/logging scans passed.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14

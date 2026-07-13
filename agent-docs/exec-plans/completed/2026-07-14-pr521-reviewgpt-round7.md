# PR 521 ReviewGPT Round 7

## Goal

Close the three concrete Round 7 findings without replacing the device-event
reconciliation architecture or adding durable state.

## Accepted findings

1. Exact corrected delivery can accept an older physical revision or recreate a
   missing event under the incoming content-derived ID instead of its stored ID.
2. An ambiguous raw-only delivery can return an unpersisted input draft as a
   canonical event and overstate downstream historical coverage.
3. A malformed concatenated journal row can hide a requested deterministic ID
   from tolerant inspection.

## Rejected proposal

Do not replace the complete ownership/reconciliation pipeline in this PR. The
review's concrete disagreements are valid, but the proposed broad deletion and
single-disposition rewrite is not required to prove these three corrections and
would materially expand regression risk.

## Invariants

- A stored exact event output remains the canonical repair ID.
- Older or missing physical state repairs; newer/user-edited/tombstoned/distinct
  owners remain protected.
- Returned events are physically current or appended by this operation.
- Raw-only ambiguous deliveries return zero canonical events.
- A requested JSON ID token inside malformed history is fail-closed.

## Verification

- Focused tests reproduced all three accepted findings before the production fix.
- The focused preservation matrix passed after the fix, including newer source
  revisions, user edits, tombstones, dedupe survivors, malformed rows, and
  missing-output repair.
- The full importer suite exposed five adjacent preservation regressions. The
  repair mapper now considers only missing safe candidates, while protected
  historical outputs remain eligible for exact no-op authorization.
- Final security review found that two distinct missing events with the same
  role set could claim one stored output ID. Stored-output assignment is now
  injective and fails closed when one output competes across prepared events.
- `pnpm --filter @murphai/core exec vitest run test/device-import.test.ts test/integration-ingests.test.ts`
  passed: 150 tests.
- Final `pnpm --filter @murphai/core test:coverage` passed: 41 files, 647
  tests, 90.45% statements, 82.05% branches, 95.81% functions, 90.53% lines.
- `pnpm --filter @murphai/core typecheck` and `git diff --check` passed.
- `pnpm test:diff` reached affected workspace typechecks, then stopped on the
  unchanged `packages/hosted-execution/test/hosted-execution.test.ts:548`
  missing `@murphai/hosted-execution/clinical-records` module already recorded
  in the prior round; core checks completed independently above.
- Coverage-write specialist completed. Final security/privacy review found and
  accepted the injective-assignment issue above; its focused regression passes,
  the re-review closed the finding, and no medium-or-higher issue remains.
- Exact-head ReviewGPT and full GitHub CI remain required after push.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13

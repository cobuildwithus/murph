# PR 521 ReviewGPT Round 8

## Goal

Close the two concrete Round 8 findings by narrowing historical ownership and
deriving repaired outputs from physical owners, without adding durable state or
another reconciliation layer.

## Accepted findings

1. Ref-only historical recovery can discard a distinct event that legitimately
   reuses a resource ID formerly used as another event's legacy ID.
2. Stored-output repair can assign a protected event's historical output ID to
   a different missing event, and reconciliation intent can return a draft that
   the append plan did not persist.

## Complexity disposition

ReviewGPT reported no separate complexity collapse. Delete the broad ref-only
fallback, extend the existing transient ownership facts to reserve protected
outputs, and filter returned events with the existing physical append result.

## Invariants

- Historical-owner recovery requires content-fingerprint proof.
- Same-batch legacy reservations continue to protect live alias collisions.
- Stored output IDs are assigned injectively across the whole prepared batch,
  including protected and already-current events.
- A repaired result returns only a current record or an event actually appended
  by the operation.
- Evidence association likewise requires a current owner or an actual append;
  unresolved planning eligibility alone is not ownership proof.
- Ambiguous repair fails before any event, ingest, or audit write.

## Verification

- Coverage-write added focused tests for both accepted findings. The production
  fix landed before their first command completed, so no pre-fix failure output
  was captured; both pass on the corrected code.
- Focused preservation passed: six core moved-owner/repair cases and two
  importer same-batch/adjacent cases.
- Final `pnpm --filter @murphai/core exec vitest run test/device-import.test.ts test/integration-ingests.test.ts`
  passed: 154 tests.
- Final `pnpm --filter @murphai/core test:coverage` passed: 41 files, 650
  tests, 90.47% statements, 82.06% branches, 95.81% functions, 90.55% lines.
- Core typecheck and `git diff --check` passed.
- `pnpm test:diff` passed repository guards and workspace boundaries, then
  stopped at the unchanged `packages/hosted-execution/test/hosted-execution.test.ts:548`
  missing `@murphai/hosted-execution/clinical-records` module already recorded
  in prior rounds.
- Required coverage-write specialist completed. Security/privacy review found
  and accepted one Medium gap where an unresolved, unappended association-safe
  draft could still authorize an evidence association. The current-or-appended
  owner guard closes the first write; a focused test then exposed that replay of
  the intentional raw-only row was treated as damage. Stored-delivery retention
  now recognizes an unresolved prepared id that is physically occupied while
  continuing to emit zero event associations; focused replay and the nine-test
  ownership/security matrix pass. Final security re-review closed the finding;
  no medium-or-higher security, privacy, or data-integrity issue remains.
- Exact-head ReviewGPT and full GitHub CI remain required after push.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13

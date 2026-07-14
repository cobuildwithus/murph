# PR 614 ReviewGPT Round 5

## Goal

Validate and close the exact-head authority-rebuild and bounded-completeness
findings without weakening exact replay, safe anchored repair, or fail-closed
provenance checks.

## Evidence

- ReviewGPT completed a valid Pro-model review of `bd1e82b02b` with the guarded
  ZIP and `REVIEW_COMPLETE` marker.
- The review identified two production-boundary hypotheses: a tail-derived
  repair plan may survive contradictory evidence found by mandatory full
  inspection, and revision completeness may perform work proportional to a
  schema-valid numeric revision while the canonical write lock is held.
- Both paths require production-boundary proof before implementation.

## Plan

1. Reconstruct the claimed clean-tail/contradictory-full-history state and
   verify whether the association candidate remains selectable while an
   accepted member needs repair.
2. Add direct complete, gapped, and huge-revision coverage for durable revision
   completeness through a stale-provider import boundary.
3. Change full-inspection plan ownership only if the claimed stale-plan path is
   reachable through the production candidate-ID and role-selection rules.
4. Replace numeric revision iteration with a positive-safe-integer cardinality
   proof over the already-indexed revision set.
5. Run focused and full owner verification, required completion audits, close
   the plan, push, and start the next exact-head ReviewGPT round with CI.

## Invariants

- Every committed repair plan is derived from the complete authoritative
  candidate set at the irreversible write boundary.
- Contradictory historical ownership or roles fail closed without changing
  vault bytes.
- Completeness work is bounded by indexed state, never by an untrusted numeric
  revision value.
- Any accepted fix adds no persisted state, dependency, service, queue, or
  compatibility layer.

## Outcome

- Accepted the unbounded revision-completeness finding. A schema-valid huge
  revision reached a numeric loop while the canonical write lock was held.
  Completeness now requires a positive safe maximum and set cardinality equal
  to that maximum, making work constant-time in the numeric revision value.
- Rejected the stale tail-derived repair-plan finding after reconstructing the
  proposed dedupe, association, partial-loss, and contradictory-history state.
  Once an accepted member is missing, the current association candidate ID is
  derived from only the surviving role set. A prior association containing the
  missing role is therefore not a candidate; a current clean candidate with
  only surviving roles fails before full inspection because it cannot identify
  every missing accepted member. No authority-path code change was warranted.
- Added one focused huge-revision exact-replay regression. The correction
  removes the numeric loop and adds no state, abstraction, or dependency.

## Verification

- `pnpm --dir packages/core typecheck` passed.
- `pnpm test:scenario-integrity` passed all 207 scenarios across 11 inputs and
  28 golden directories.
- `pnpm --dir packages/core exec vitest run test/device-import.test.ts` passed
  all 153 tests.
- The focused WHOOP/Junction completeness matrix passed all 10 tests.
- `pnpm --dir packages/core test:coverage` passed 684 tests and reported 90.19%
  statements, 81.78% branches, 95.49% functions, and 90.25% lines. The command
  exited nonzero only because the known unrelated `preferences.test.ts`
  causal-token test timed out at 60 seconds and hit its cleanup race.
- Coverage-write and security/privacy completion audits reported zero
  medium-or-higher findings and made no edits.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14

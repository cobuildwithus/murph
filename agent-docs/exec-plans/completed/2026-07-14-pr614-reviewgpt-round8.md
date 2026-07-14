# PR 614 ReviewGPT Round 8

## Goal

Close the exact-repair per-member proof and final no-op authorization gaps
without adding state or a parallel replay owner.

## Evidence

- ReviewGPT completed a valid Pro-model review of `6d18816665` with the guarded
  ZIP and `REVIEW_COMPLETE` marker.
- Exact subset rows can uniquely map different prepared members to the same
  canonical output, but the current repair path compares the owner-wide role
  union against one stored row and discards the later per-member proof map.
- The unsafe/incomplete-history guard protects the early no-op return, but a
  later identical-association append plan can independently return a no-op.

## Plan

1. Add production-faithful failing regressions for split-subset proof and the
   malformed-history stranded-association no-op.
2. Make one transient per-prepared-member canonical-output map own accepted
   exact proof, conflict detection, and repair IDs.
3. Route both no-op exits through the same authoritative-inspection assertion.
4. Run focused and full core verification plus required completion audits.
5. Close the plan, commit, push, update the PR, and run ReviewGPT on the exact
   pushed head concurrently with CI.

## Invariants

- Append-only exact rows add positive proof; omission is not revocation and
  conflicting canonical-output mappings fail closed.
- An unresolved accepted member cannot be certified as converged from unsafe
  or incomplete exact-delivery history.
- The fix adds no persisted state, dependency, service, queue, or compatibility
  layer.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14

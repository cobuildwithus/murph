# PR 614 ReviewGPT Round 9

## Goal

Prove and close the remaining historical-revision and partial-candidate repair
authority gaps without adding persisted state or another replay owner.

## Evidence

- ReviewGPT completed a valid Pro-model review of `a107fe7ab3` with the guarded
  ZIP and `REVIEW_COMPLETE` marker.
- The review reports that exact stored-output proof may restore an accepted
  member at a new lifecycle revision when the original placement is not
  uniquely established.
- The review also reports that partial-only evidence may be promoted to a
  complete association while a missing event member remains unresolved.
- Both reports remain hypotheses until reproduced on the reviewed head with
  focused, production-faithful tests.

## Plan

1. Add failing byte-stability regressions for the reported historical revision
   relocation and partial-candidate false-convergence paths.
2. Keep accepted per-member stored proof and any uniquely derived historical
   revision in one transient decision path used by repair, persistence, and
   both no-op exits.
3. Delete parallel owner-wide inference where it can disagree with that proof;
   fail closed when exact placement or member disposition remains unresolved.
4. Run focused and full core verification plus required completion audits.
5. Close the plan, commit, push, update the PR, and run ReviewGPT on the exact
   pushed head concurrently with CI.

## Invariants

- Accepted lifecycle revisions remain stable across retry and repair.
- Partial evidence cannot certify an unresolved event member as converged.
- User edits, tombstones, and ambiguous historical placement fail closed
  without mutating any vault file.
- The fix adds no persisted state, dependency, service, queue, or compatibility
  layer.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
